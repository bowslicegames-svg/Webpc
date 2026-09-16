// fake-gpu/fakegpu.c
// Minimal fake GPU misc device with mmap'd ring buffer and ioctls.
// Build with: make (Makefile provided below)

#include <linux/module.h>
#include <linux/init.h>
#include <linux/fs.h>
#include <linux/miscdevice.h>
#include <linux/mm.h>
#include <linux/slab.h>
#include <linux/uaccess.h>
#include <linux/wait.h>
#include <linux/poll.h>
#include <linux/ioctl.h>

#define DRIVER_NAME "fakegpu"
#define DEVICE_NAME "fakegpu"

// Ring buffer sizes (tuneable)
#define FG_RING_PAGES 16
#define FG_PAGE_ORDER 0
#define FG_PAGE_SIZE PAGE_SIZE
#define FG_RING_SIZE (FG_RING_PAGES * FG_PAGE_SIZE)

// IOCTLs
#define FG_IOC_MAGIC 'F'
#define FG_IOC_SUBMIT _IOW(FG_IOC_MAGIC, 1, uint32_t) // submit length (bytes)
#define FG_IOC_WAIT   _IOR(FG_IOC_MAGIC, 2, uint32_t) // wait for consumed bytes
#define FG_IOC_RESET  _IO(FG_IOC_MAGIC, 3)
#define FG_IOC_GET_CAPS _IOR(FG_IOC_MAGIC, 4, uint32_t) // returns capabilities bitmask

struct fg_header {
    uint32_t head;   // write position (userland)
    uint32_t tail;   // consumed position (kernel/consumer)
    uint32_t size;   // ring buffer size in bytes
    uint32_t flags;  // reserved
};

struct fg_dev {
    struct fg_header *hdr;
    void *ring; // pointer to ring buffer (virt)
    size_t ring_size;
    wait_queue_head_t waitq;
    struct mutex lock;
    struct miscdevice misc;
};

static struct fg_dev *gdev;

static int fg_open(struct inode *inode, struct file *file)
{
    file->private_data = gdev;
    return 0;
}

static int fg_release(struct inode *inode, struct file *file)
{
    return 0;
}

static long fg_ioctl(struct file *file, unsigned int cmd, unsigned long arg)
{
    struct fg_dev *dev = file->private_data;
    uint32_t val;

    switch (cmd) {
    case FG_IOC_SUBMIT:
        if (copy_from_user(&val, (uint32_t __user *)arg, sizeof(val)))
            return -EFAULT;
        // userland already advanced head in header; we just wake consumer
        wake_up_interruptible(&dev->waitq);
        return 0;
    case FG_IOC_WAIT:
        if (copy_from_user(&val, (uint32_t __user *)arg, sizeof(val)))
            return -EFAULT;
        // Wait until tail >= val (consumer consumed at least val bytes)
        wait_event_interruptible(dev->waitq, dev->hdr->tail >= val);
        if (copy_to_user((uint32_t __user *)arg, &dev->hdr->tail, sizeof(dev->hdr->tail)))
            return -EFAULT;
        return 0;
    case FG_IOC_RESET:
        mutex_lock(&dev->lock);
        dev->hdr->head = dev->hdr->tail = 0;
        mutex_unlock(&dev->lock);
        wake_up_interruptible(&dev->waitq);
        return 0;
    case FG_IOC_GET_CAPS:
        val = 0; // define capability bits later
        if (copy_to_user((uint32_t __user *)arg, &val, sizeof(val)))
            return -EFAULT;
        return 0;
    default:
        return -ENOTTY;
    }
}

static unsigned int fg_poll(struct file *file, poll_table *wait)
{
    struct fg_dev *dev = file->private_data;
    unsigned int mask = 0;

    poll_wait(file, &dev->waitq, wait);

    // If there is space (tail + size - head > 0) signal writable
    if (((dev->hdr->tail + dev->hdr->size) - dev->hdr->head) > 0)
        mask |= POLLOUT | POLLWRNORM;

    // If there is data (head > tail) signal readable for consumer
    if (dev->hdr->head > dev->hdr->tail)
        mask |= POLLIN | POLLRDNORM;

    return mask;
}

static int fg_mmap(struct file *file, struct vm_area_struct *vma)
{
    struct fg_dev *dev = file->private_data;
    unsigned long len = vma->vm_end - vma->vm_start;
    unsigned long pfn;
    void *src;
    int i;
    size_t to_map;

    if (len < sizeof(struct fg_header))
        return -EINVAL;

    // Map header first page
    to_map = min((size_t)len, (size_t)PAGE_SIZE);
    pfn = virt_to_phys(dev->hdr) >> PAGE_SHIFT;
    if (remap_pfn_range(vma, vma->vm_start, pfn, to_map, vma->vm_page_prot))
        return -EAGAIN;

    // Map ring buffer after header
    src = dev->ring;
    for (i = 0; i < FG_RING_PAGES; i++) {
        unsigned long addr = vma->vm_start + PAGE_SIZE + i * PAGE_SIZE;
        pfn = virt_to_phys(src + i * PAGE_SIZE) >> PAGE_SHIFT;
        if (remap_pfn_range(vma, addr, pfn, PAGE_SIZE, vma->vm_page_prot))
            return -EAGAIN;
    }

    return 0;
}

static const struct file_operations fg_fops = {
    .owner = THIS_MODULE,
    .open = fg_open,
    .release = fg_release,
    .unlocked_ioctl = fg_ioctl,
    .poll = fg_poll,
    .mmap = fg_mmap,
};

static int __init fg_init(void)
{
    int i;
    struct fg_dev *dev;
    void *ring;
    struct fg_header *hdr;

    dev = kzalloc(sizeof(*dev), GFP_KERNEL);
    if (!dev) return -ENOMEM;

    dev->ring_size = FG_RING_SIZE;
    ring = (void *)__get_free_pages(GFP_KERNEL | __GFP_ZERO, 0); // allocate pages in loop below
    if (!ring) {
        kfree(dev);
        return -ENOMEM;
    }
    // allocate contiguous pages for ring
    // For simplicity allocate with kmalloc for small sizes; for production use alloc_pages
    ring = kzalloc(dev->ring_size, GFP_KERNEL);
    if (!ring) {
        kfree(dev);
        return -ENOMEM;
    }

    hdr = kzalloc(sizeof(*hdr), GFP_KERNEL);
    if (!hdr) {
        kfree(ring);
        kfree(dev);
        return -ENOMEM;
    }

    hdr->head = 0;
    hdr->tail = 0;
    hdr->size = dev->ring_size;

    dev->hdr = hdr;
    dev->ring = ring;

    init_waitqueue_head(&dev->waitq);
    mutex_init(&dev->lock);

    dev->misc.minor = MISC_DYNAMIC_MINOR;
    dev->misc.name = DEVICE_NAME;
    dev->misc.fops = &fg_fops;

    if (misc_register(&dev->misc)) {
        kfree(hdr);
        kfree(ring);
        kfree(dev);
        return -EBUSY;
    }

    gdev = dev;
    pr_info("fakegpu: device registered as /dev/%s\n", DEVICE_NAME);
    return 0;
}

static void __exit fg_exit(void)
{
    if (!gdev) return;
    misc_deregister(&gdev->misc);
    kfree(gdev->hdr);
    kfree(gdev->ring);
    kfree(gdev);
    pr_info("fakegpu: unloaded\n");
}

module_init(fg_init);
module_exit(fg_exit);

MODULE_LICENSE("GPL");
MODULE_AUTHOR("bowslice");
MODULE_DESCRIPTION("Minimal fake GPU misc device for command streaming");
