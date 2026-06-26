// Minimal Arduino shim — JUST enough of String/Print for the config engine to
// compile and run natively under MSVC. Not used in the firmware build (there
// <Arduino.h> resolves to the real framework header).
#pragma once
#include <string>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <cstdio>
#include <cctype>

class String {
    std::string s;
public:
    String() {}
    String(const char* c) { if (c) s = c; }
    String(const std::string& x) : s(x) {}
    String(int v) { char b[16]; snprintf(b, sizeof(b), "%d", v); s = b; }
    const char* c_str() const { return s.c_str(); }
    size_t length() const { return s.size(); }
    void reserve(size_t) {}
    const std::string& str() const { return s; }
    String& operator=(const String& o) { s = o.s; return *this; }
    String& operator+=(const String& o) { s += o.s; return *this; }
    String operator+(const String& o) const { return String(s + o.s); }
    String operator+(const char* o) const { return String(s + (o ? o : "")); }
    String operator+(int v) const { char b[16]; snprintf(b, sizeof(b), "%d", v); return String(s + b); }
    bool operator==(const char* o) const { return o && s == o; }
    bool operator==(const String& o) const { return s == o.s; }
    bool operator!=(const char* o) const { return !(*this == o); }
    char operator[](size_t i) const { return i < s.size() ? s[i] : 0; }
    // --- the subset of Arduino String's API the config serial console uses ---
    int indexOf(char c) const { auto p = s.find(c); return p == std::string::npos ? -1 : (int)p; }
    int indexOf(char c, int from) const { auto p = s.find(c, from < 0 ? 0 : from); return p == std::string::npos ? -1 : (int)p; }
    String substring(int from) const { return from >= 0 && from <= (int)s.size() ? String(s.substr(from)) : String(); }
    String substring(int from, int to) const {
        if (from < 0) from = 0; if (to > (int)s.size()) to = (int)s.size();
        return to > from ? String(s.substr(from, to - from)) : String();
    }
    bool startsWith(const char* p) const { return p && s.rfind(p, 0) == 0; }
    void trim() {
        size_t a = 0, b = s.size();
        while (a < b && (unsigned char)s[a] <= ' ') a++;
        while (b > a && (unsigned char)s[b - 1] <= ' ') b--;
        s = s.substr(a, b - a);
    }
    void toLowerCase() { for (auto& c : s) c = (char)tolower((unsigned char)c); }
};
inline String operator+(const char* a, const String& b) { return String(std::string(a ? a : "") + b.str()); }

#define constrain(x, lo, hi) ((x) < (lo) ? (lo) : ((x) > (hi) ? (hi) : (x)))

class Print {
public:
    virtual ~Print() {}
    virtual void print(const char* c) = 0;
    void print(const String& v) { print(v.c_str()); }
    void print(int v) { char b[16]; snprintf(b, sizeof(b), "%d", v); print(b); }
    void println() { print("\n"); }
    void println(const char* c) { print(c); print("\n"); }
    void println(const String& v) { print(v); print("\n"); }
};

// Minimal Stream so config_serial.cpp (begin/poll) compiles natively; the native
// test only drives the pure execute() path, never poll(), so these are stubs.
class Stream : public Print {
public:
    virtual int available() { return 0; }
    virtual int read() { return -1; }
    void print(const char* c) override { (void)c; }
};
