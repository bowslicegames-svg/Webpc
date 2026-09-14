#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <time.h>

// Simple framebuffer API for optional graphics
#define FB_W 320
#define FB_H 200
static uint32_t framebuffer[FB_W * FB_H];

// Expose functions for JS to call
uint32_t* get_framebuffer_ptr() { return framebuffer; }
int get_framebuffer_width() { return FB_W; }
int get_framebuffer_height() { return FB_H; }

// Optional key hook
static int last_key = 0;
void vm_key(int k) { last_key = k; printf("[VM] key %d\n", k); fflush(stdout); }

static void draw_frame(int f) {
  uint32_t color = 0xFF000000 | ((f * 37) & 0x00FFFFFF);
  for (int i = 0; i < FB_W * FB_H; ++i) framebuffer[i] = color;
}

int main(int argc, char** argv) {
  printf("TinyEMU WASM demo stub: starting\n");
  fflush(stdout);

  for (int i = 0; i < 5; ++i) {
    printf("Boot step %d/5\n", i+1);
    fflush(stdout);
    volatile unsigned long t = 0;
    for (unsigned long j = 0; j < 20000000UL; ++j) t += j;
  }

  printf("Entering main loop\n");
  fflush(stdout);

  int frame = 0;
  while (1) {
    draw_frame(frame++);
    if (last_key) {
      printf("Key seen: %d\n", last_key);
      last_key = 0;
      fflush(stdout);
    }
    struct timespec ts = {0, 33 * 1000 * 1000}; // ~33ms
    nanosleep(&ts, NULL);
  }

  return 0;
}
