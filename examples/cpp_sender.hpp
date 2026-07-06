/**
 * examples/cpp_sender.hpp — transport layer using canonical protocol/ format.
 *
 * Uses 12-byte header: [magic:4 "FRAM"][body_size:4][type_tag:4][body...]
 * Payload-agnostic: sender doesn't know or care what the bytes mean.
 *
 * Usage:
 *   PipeFrameSender sender;
 *   sender.send(PAYLOAD_TYPE_BGRA_FRAME, my_data, my_data_size);
 *
 *   TcpFrameSender sender;
 *   sender.listen(9999);
 *   sender.broadcast(PAYLOAD_TYPE_BGRA_FRAME, my_data, my_data_size);
 */
#pragma once
#include <cstdint>
#include <cstdio>
#include <vector>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <io.h>
#include <fcntl.h>
#include "../../protocol/protocol.h"

#pragma comment(lib, "ws2_32.lib")

// ═══ Pipe 发送端 ═══
struct PipeFrameSender {
    PipeFrameSender() { _setmode(_fileno(stdout), _O_BINARY); }

    bool send(uint32_t type_tag, const void* data, uint32_t size) {
        uint8_t hdr[PROTOCOL_FRAME_HEADER];
        protocol_build_header(hdr, size, type_tag);
        if (fwrite(hdr, 1, sizeof(hdr), stdout) != sizeof(hdr)) return false;
        if (size > 0 && fwrite(data, 1, size, stdout) != size) return false;
        fflush(stdout);
        return true;
    }

    bool send(uint32_t type_tag, const std::vector<uint8_t>& data) { return send(type_tag, data.data(), (uint32_t)data.size()); }
};

// ═══ TCP 广播端 ═══
struct TcpFrameSender {
    TcpFrameSender() { WSADATA wsa; WSAStartup(MAKEWORD(2,2), &wsa); }
    ~TcpFrameSender() { close(); WSACleanup(); }

    bool listen(uint16_t port = PROTOCOL_DEFAULT_TCP_PORT) {
        sock_ = socket(AF_INET, SOCK_STREAM, 0);
        if (sock_ == INVALID_SOCKET) return false;
        int opt = 1; setsockopt(sock_, SOL_SOCKET, SO_REUSEADDR, (char*)&opt, sizeof(opt));
        sockaddr_in addr = {};
        addr.sin_family = AF_INET; addr.sin_port = htons(port);
        addr.sin_addr.s_addr = inet_addr("127.0.0.1");
        if (bind(sock_, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) return false;
        if (::listen(sock_, 5) == SOCKET_ERROR) return false;
        printf("[tcp] listening on 127.0.0.1:%d\n", port);
        return true;
    }

    void accept_clients() {
        SOCKET c = accept(sock_, nullptr, nullptr);
        if (c == INVALID_SOCKET) return;
        u_long mode = 0; ioctlsocket(c, FIONBIO, &mode);
        clients_.push_back(c);
        printf("[tcp] client connected (%zu total)\n", clients_.size());
    }

    static bool send_all(SOCKET s, const char* data, int len) {
        int sent = 0;
        while (sent < len) {
            int n = send(s, data + sent, len - sent, 0);
            if (n <= 0) return false;
            sent += n;
        }
        return true;
    }

    void broadcast(uint32_t type_tag, const void* data, uint32_t size) {
        uint8_t hdr[PROTOCOL_FRAME_HEADER];
        protocol_build_header(hdr, size, type_tag);
        auto it = clients_.begin();
        while (it != clients_.end()) {
            bool ok = send_all(*it, (char*)hdr, sizeof(hdr));
            if (ok && size > 0) ok = send_all(*it, (char*)data, (int)size);
            if (!ok) { closesocket(*it); it = clients_.erase(it); }
            else ++it;
        }
    }

    void broadcast(uint32_t type_tag, const std::vector<uint8_t>& data) { broadcast(type_tag, data.data(), (uint32_t)data.size()); }

    void close() {
        for (auto c : clients_) closesocket(c);
        clients_.clear();
        if (sock_ != INVALID_SOCKET) { closesocket(sock_); sock_ = INVALID_SOCKET; }
    }

private:
    SOCKET sock_ = INVALID_SOCKET;
    std::vector<SOCKET> clients_;
};
