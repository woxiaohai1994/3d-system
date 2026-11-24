/* SPDX-License-Identifier: GPL-2.0-or-later */
#include <cstdint>

// Unit formatting writes to memory. These unused libc file/clock paths have no host access.
extern "C" {
uint16_t __wrap___wasi_clock_time_get(uint32_t, uint64_t, uint64_t *) { return 52; }
uint16_t __wrap___wasi_fd_close(uint32_t) { return 8; }
uint16_t __wrap___wasi_fd_seek(uint32_t, int64_t, uint32_t, uint64_t *) { return 8; }
uint16_t __wrap___wasi_fd_write(uint32_t, const void *, uint32_t, uint32_t *) { return 8; }
}
