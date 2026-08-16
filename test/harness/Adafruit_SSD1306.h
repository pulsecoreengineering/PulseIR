/** Host stub of the Adafruit SSD1306 library — just enough surface to compile. */
#ifndef PULSE_TEST_ADAFRUIT_SSD1306_H
#define PULSE_TEST_ADAFRUIT_SSD1306_H
#define SSD1306_WHITE      1
#define SSD1306_SWITCHCAPVCC 0x2
class Adafruit_SSD1306 {
public:
  Adafruit_SSD1306(int w, int h, void* wire, int rst) {
    (void)w; (void)h; (void)wire; (void)rst;
  }
  bool begin(int vcs, int addr) { (void)vcs; (void)addr; return true; }
  void clearDisplay() {}
  void setTextSize(int s) { (void)s; }
  void setTextColor(int c) { (void)c; }
  void setCursor(int x, int y) { (void)x; (void)y; }
  void print(const char* s) { (void)s; }
  void print(float v) { (void)v; }
  void display() {}
};
#endif
