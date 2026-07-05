/**
 * hello_cpp_send.cpp — C++ sends "hello world" over pipe.
 *
 * 编译: cl.exe /EHsc /std:c++17 hello_cpp_send.cpp
 * 运行: ./hello_cpp_send.exe | cargo run --example hello_rust_recv
 *
 * 流程:
 *   "hello world" 字符串 → 直接作为 payload  → pipe.send(type=3, data, len)
 *   接收端读到 type=3 就知道这是文本消息
 */
#include <cstdio>
#include <cstring>
#include "../common/transport/pipe.hpp"

int main() {
    transport::PipeSender pipe;

    const char* msg = "hello world from C++";
    fprintf(stderr, "[cpp] sending: \"%s\"\n", msg);

    // type_tag=3 = CONTROL_MSG (文本/JSON). 也可以直接当 raw bytes.
    // 如果 type_tag 用 1=BGRA_FRAME, 接收端就会按像素解析 — 会失败.
    pipe.send(PAYLOAD_TYPE_CONTROL_MSG, msg, (uint32_t)strlen(msg));

    fprintf(stderr, "[cpp] done\n");
    return 0;
}
