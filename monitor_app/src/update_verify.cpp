// update_verify.cpp — ECDSA P-256 manifest signature verification (CNG/BCrypt).
// Self-contained: minimal JSON string extraction, base64 decode, raw SHA256, and
// BCryptVerifySignature against the embedded public key. Reuses the same bcrypt.lib
// already linked for sha256_util. See update_verify.h for the signature scheme.
#include "update_verify.h"
#include "update_pubkey.h"   // GAM_UPDATE_PUBKEY (BCRYPT_ECCPUBLIC_BLOB, generated)
#include <windows.h>
#include <bcrypt.h>
#include <vector>
#include <algorithm>
#include <utility>
#pragma comment(lib, "bcrypt.lib")

// ── Minimal JSON string-value extraction (values that are quoted strings) ──
static std::string jstr_from(const std::string& s, const char* key, size_t from) {
    std::string k = "\""; k += key; k += "\"";
    size_t p = s.find(k, from);
    if (p == std::string::npos) return "";
    p = s.find(':', p + k.size());
    if (p == std::string::npos) return "";
    p++;
    while (p < s.size() && (s[p] == ' ' || s[p] == '\t')) p++;
    if (p >= s.size() || s[p] != '"') return "";
    size_t e = s.find('"', p + 1);
    if (e == std::string::npos) return "";
    return s.substr(p + 1, e - p - 1);
}

// Extract (path, sha256) for every entry in the "files" object. Depth-1 quoted
// keys are file paths; each value object (depth 2) holds "sha256". Mirrors the
// diff walk in commands.cpp.
static void parse_files(const std::string& m,
                        std::vector<std::pair<std::string, std::string>>& out) {
    size_t fp = m.find("\"files\"");
    if (fp == std::string::npos) return;
    size_t pos = m.find('{', fp);
    if (pos == std::string::npos) return;
    int depth = 0;
    for (size_t i = pos; i < m.size(); i++) {
        char c = m[i];
        if (c == '{') depth++;
        else if (c == '}') { depth--; if (depth == 0) break; }
        else if (depth == 1 && c == '"') {
            size_t ke = m.find('"', i + 1);
            if (ke == std::string::npos) break;
            std::string path = m.substr(i + 1, ke - i - 1);
            std::string sha  = jstr_from(m, "sha256", ke);
            out.push_back(std::make_pair(path, sha));
            i = ke;
        }
    }
}

// ── base64 decode (skips whitespace/padding) ──
static int b64val(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}
static int b64decode(const std::string& in, unsigned char* out, int outCap) {
    int val = 0, bits = -8, n = 0;
    for (char c : in) {
        int d = b64val(c);
        if (d < 0) continue;          // '=', whitespace, anything non-alphabet
        val = (val << 6) | d; bits += 6;
        if (bits >= 0) {
            if (n < outCap) out[n++] = (unsigned char)((val >> bits) & 0xFF);
            bits -= 8;
        }
    }
    return n;
}

// ── raw SHA256 (32 bytes) via CNG ──
static bool sha256_raw(const void* data, size_t len, unsigned char out[32]) {
    BCRYPT_ALG_HANDLE hAlg = nullptr;
    BCRYPT_HASH_HANDLE hHash = nullptr;
    bool ok = false;
    if (BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_SHA256_ALGORITHM, nullptr, 0) == 0) {
        if (BCryptCreateHash(hAlg, &hHash, nullptr, 0, nullptr, 0, 0) == 0) {
            if (BCryptHashData(hHash, (PUCHAR)data, (ULONG)len, 0) == 0 &&
                BCryptFinishHash(hHash, out, 32, 0) == 0)
                ok = true;
            BCryptDestroyHash(hHash);
        }
        BCryptCloseAlgorithmProvider(hAlg, 0);
    }
    return ok;
}

bool update_manifest_is_signed(const std::string& manifest) {
    return !jstr_from(manifest, "sig", 0).empty();
}

bool update_verify_manifest(const std::string& manifest) {
    std::string sigB64 = jstr_from(manifest, "sig", 0);
    if (sigB64.empty()) return false;

    unsigned char sig[64];
    if (b64decode(sigB64, sig, (int)sizeof(sig)) != 64) return false;   // P-256 r||s

    // Rebuild the canonical digest: ordinal-sorted "<path>\n<sha256>\n".
    std::vector<std::pair<std::string, std::string>> files;
    parse_files(manifest, files);
    if (files.empty()) return false;
    std::sort(files.begin(), files.end());   // by path (ordinal), then sha (unused tiebreak)

    std::string canon;
    for (size_t i = 0; i < files.size(); i++) {
        canon += files[i].first;  canon += '\n';
        canon += files[i].second; canon += '\n';
    }
    unsigned char hash[32];
    if (!sha256_raw(canon.data(), canon.size(), hash)) return false;

    // Verify against the embedded public key.
    BCRYPT_ALG_HANDLE hAlg = nullptr;
    BCRYPT_KEY_HANDLE hKey = nullptr;
    bool ok = false;
    if (BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_ECDSA_P256_ALGORITHM, nullptr, 0) == 0) {
        if (BCryptImportKeyPair(hAlg, nullptr, BCRYPT_ECCPUBLIC_BLOB, &hKey,
                (PUCHAR)GAM_UPDATE_PUBKEY, (ULONG)sizeof(GAM_UPDATE_PUBKEY), 0) == 0) {
            ok = (BCryptVerifySignature(hKey, nullptr, hash, 32, sig, 64, 0) == 0);
            BCryptDestroyKey(hKey);
        }
        BCryptCloseAlgorithmProvider(hAlg, 0);
    }
    return ok;
}
