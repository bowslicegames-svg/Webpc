#ifndef LIBFAKEGPU_H
#define LIBFAKEGPU_H

#include <stdint.h>

struct fg_handle;
struct fg_handle *fg_open(const char *path);
void fg_close(struct fg_handle *h);
int fg_submit(struct fg_handle *h, uint32_t bytes);
int fg_wait_consumed(struct fg_handle *h, uint32_t want);

#endif
