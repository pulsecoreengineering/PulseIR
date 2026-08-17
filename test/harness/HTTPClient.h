/** Host stub of the HTTPClient library — just enough surface to compile. */
#ifndef PULSE_TEST_HTTPCLIENT_H
#define PULSE_TEST_HTTPCLIENT_H
#include <string>
#define HTTP_CODE_OK 200
// Minimal String type so generated code compiles in the host test harness.
struct String {
  String() = default;
  String(const char*) {}
};
class HTTPClient {
public:
  void begin(const char* url)                      { (void)url; }
  void addHeader(const char* name, const char* val){ (void)name; (void)val; }
  int  GET()                                       { return HTTP_CODE_OK; }
  int  POST(const char* body)                      { (void)body; return HTTP_CODE_OK; }
  String getString()                               { return {}; }
  void end()                                       {}
};
#endif
