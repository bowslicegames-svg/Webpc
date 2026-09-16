CC = gcc
CFLAGS = -O2 -Wall
LIBS =
TARGETS = test_submit

all: $(TARGETS)

test_submit: test_submit.c libfakegpu.c
    $(CC) $(CFLAGS) -o $@ test_submit.c libfakegpu.c $(LIBS)

clean:
    rm -f $(TARGETS) *.o
