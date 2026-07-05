/**
 * hello_tcp_send.cpp — C++ TCP server, broadcasts "hello world".
 *
 * 编译: cl.exe /EHsc /std:c++17 hello_tcp_send.cpp ws2_32.lib
 * 运行: ./hello_tcp_send.exe
 *       (另开终端) python examples/hello_python_recv.py
 */
#include <cstdio>
#include <cstring>
#include <thread>
#include <chrono>
#include "../common/transport/tcp.hpp"

int main() {
    transport::TcpSender tcp;
    if (!tcp.listen()) { fprintf(stderr, "listen failed\n"); return 1; }
    printf("[cpp] listening on :%d\n", PROTOCOL_DEFAULT_TCP_PORT);

    const char* msg = "hello world from C++ over TCP";
    for (int i = 0; i < 10; i++) {
        tcp.accept_clients();
        tcp.broadcast(PAYLOAD_TYPE_CONTROL_MSG, msg, (uint32_t)strlen(msg));
        printf("[cpp] sent: \"%s\"\n", msg);
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }
    printf("[cpp] done\n");
    return 0;
}
