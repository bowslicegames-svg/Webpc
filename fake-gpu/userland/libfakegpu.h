#ifndef LIBFAKEGPU_H
#define LIBFAKEGPU_H

#include <stdint.h>

struct fg_header {
    uint32_t head;
    uint32_t tail;
    uint32_t size;
    uint32_t flags;
};

struct fg_handle {
    int fd;
    struct fg_header *hdr;
    void *ring;
    uint32_t ring_size;
};

struct fg_handle *fg_open(const char *path);
void fg_close(struct fg_handle *h);
int fg_submit(struct fg_handle *h, uint32_t bytes);
int fg_wait_consumed(struct fg_handle *h, uint32_t want);

#endif
