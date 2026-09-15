// wasm-vm/src/main.c
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <time.h>
#include <emscripten/emscripten.h>

#define FB_W 640
#define FB_H 360

static uint32_t framebuffer[FB_W * FB_H];
static volatile int last_key = 0;

// Exported getters for JS to read framebuffer pointer and size
EMSCRIPTEN_KEEPALIVE
uint32_t* get_framebuffer_ptr(void) {
    return framebuffer;
}

EMSCRIPTEN_KEEPALIVE
int get_framebuffer_width(void) {
    return FB_W;
}

EMSCRIPTEN_KEEPALIVE
int get_framebuffer_height(void) {
    return FB_H;
}

// Key hook callable from JS
EMSCRIPTEN_KEEPALIVE
void vm_key(int k) {
    last_key = k;
    printf("[VM] vm_key %d\n", k);
    fflush(stdout);
}

// Draw a simple pattern into the framebuffer
static void draw_frame(int frame) {
    uint32_t base = 0xFF000000u;
    uint32_t color = base | ((frame * 37) & 0x00FFFFFFu);
    for (int y = 0; y < FB_H; ++y) {
        for (int x = 0; x < FB_W; ++x) {
            // simple moving gradient
            uint32_t px = color ^ ((x + frame) * 31) ^ ((y + frame) * 17);
            framebuffer[y * FB_W + x] = px;
        }
    }
}

// Provide a friendly, non-blocking main that keeps runtime alive
int main(int argc, char** argv) {
    printf("TinyEMU Emscripten build: starting\n");
    fflush(stdout);

    // Print args for debugging
    printf("argc=%d\n", argc);
    for (int i = 0; i < argc; ++i) {
        printf("argv[%d]=%s\n", i, argv[i] ? argv[i] : "(null)");
    }
    fflush(stdout);

    // Warmup frames
    for (int i = 0; i < 3; ++i) {
        draw_frame(i);
    }

    // Use emscripten_set_main_loop to yield to the browser and keep running
    emscripten_set_main_loop_arg(
        (void (*)(void*)) (void*) (^(void* arg){
            static int frame = 0;
            draw_frame(frame++);
            if (last_key) {
                printf("[VM] key seen: %d\n", last_key);
                last_key = 0;
                fflush(stdout);
            }
        }),
        NULL,
        0,
        1
    );

    // Should never reach here because main loop is installed
    return 0;
}
