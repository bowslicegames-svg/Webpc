#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/mman.h>
#include <sys/ioctl.h>
#include <string.h>
#include "libfakegpu.h"

#define FG_IOC_MAGIC 'F'
#define FG_IOC_SUBMIT _IOW(FG_IOC_MAGIC, 1, uint32_t)
#define FG_IOC_WAIT   _IOR(FG_IOC_MAGIC, 2, uint32_t)
#define FG_IOC_RESET  _IO(FG_IOC_MAGIC, 3)
#define FG_IOC_GET_CAPS _IOR(FG_IOC_MAGIC, 4, uint32_t)

struct fg_handle *fg_open(const char *path)
{
    int fd = open(path, O_RDWR);
    if (fd < 0) return NULL;

    size_t map_size = 4096 + (16 * 4096); // header + ring buffer
    void *map = mmap(NULL, map_size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (map == MAP_FAILED) {
        close(fd);
        return NULL;
    }

    struct fg_handle *h = calloc(1, sizeof(*h));
    h->fd = fd;
    h->hdr = (struct fg_header *)map;
    h->ring = (void *)((char *)map + 4096);
    h->ring_size = h->hdr->size;

    return h;
}

void fg_close(struct fg_handle *h)
{
    if (!h) return;
    size_t map_size = 4096 + h->ring_size;
    munmap(h->hdr, map_size);
    close(h->fd);
    free(h);
}

int fg_submit(struct fg_handle *h, uint32_t bytes)
{
    return ioctl(h->fd, FG_IOC_SUBMIT, &bytes);
}

int fg_wait_consumed(struct fg_handle *h, uint32_t want)
{
    return ioctl(h->fd, FG_IOC_WAIT, &want);
}
