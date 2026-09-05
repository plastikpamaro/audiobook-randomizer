import { describe, expect, it } from "vitest";
import { isPublicAddress } from "@/lib/safe-fetch";

describe("SSRF-Adressfilter", () => {
  it.each(["127.0.0.1", "10.0.0.8", "172.16.4.2", "192.168.1.2", "169.254.169.254", "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fe80::1", "2001:db8::1"])("blockiert %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("erlaubt %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});
