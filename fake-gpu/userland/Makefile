CC = gcc
CFLAGS = -O2 -Wall
TARGETS = test_submit

all: $(TARGETS)

test_submit: test_submit.c libfakegpu.c
    $(CC) $(CFLAGS) -o $@ test_submit.c libfakegpu.c

clean:
    rm -f $(TARGETS) *.o
