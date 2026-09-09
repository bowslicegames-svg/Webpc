# fake-gpu

Userland and kernel stubs for a virtual GPU device. The idea: userland driver writes GL commands to a shared buffer; browser-side renderer reads and executes them.

This folder contains a minimal userland writer and a kernel-device stub for reference.
