import { describe, expect, it } from 'vitest';

import {
  PACKAGE_NAME,
  describePhoneCapabilities,
  phoneMcpServerFor,
  phoneToolsEnabled,
  unavailablePhoneStatus,
  type PhoneMcpServerConfig,
  type PhoneStatus,
} from '../src/index';

function status(overrides: Partial<PhoneStatus> = {}): PhoneStatus {
  return {
    available: true,
    a11y: { enabled: false, connected: false, canScreenshot: true },
    shell: {
      enabled: false,
      installed: false,
      running: false,
      wirelessDebugging: false,
      permission: 'unknown',
    },
    ...overrides,
  };
}

const config: PhoneMcpServerConfig = {
  name: 'phone',
  type: 'http',
  url: 'http://127.0.0.1:1234/mcp',
  headers: [{ name: 'Authorization', value: 'Bearer test' }],
  alwaysLoad: true,
};

describe('@nibi-go/phone-tools', () => {
  it('入口可在 Node 环境加载', () => {
    expect(PACKAGE_NAME).toBe('@nibi-go/phone-tools');
  });

  it('两个开关都关时不交给内核', () => {
    expect(phoneToolsEnabled(status())).toBe(false);
    expect(phoneMcpServerFor(status(), { mcpServer: () => config })).toBeNull();
  });

  it('任一开关打开且模块可用时才交给内核', () => {
    const a11y = status({ a11y: { enabled: true, connected: false, canScreenshot: true } });
    const shell = status({
      shell: {
        enabled: true,
        installed: true,
        running: true,
        wirelessDebugging: true,
        permission: 'granted',
      },
    });
    expect(phoneMcpServerFor(a11y, { mcpServer: () => config })).toEqual(config);
    expect(phoneMcpServerFor(shell, { mcpServer: () => config })).toEqual(config);
  });

  it('原生模块不可用时即使设置残留也不交给内核', () => {
    const off = status({
      available: false,
      a11y: { enabled: true, connected: true, canScreenshot: true },
    });
    expect(phoneToolsEnabled(off)).toBe(false);
    expect(phoneMcpServerFor(off, { mcpServer: () => config })).toBeNull();
  });

  it('能力摘要只列真正可用的项', () => {
    expect(describePhoneCapabilities(unavailablePhoneStatus())).toEqual(['不可用']);
    expect(describePhoneCapabilities(status())).toEqual(['未开启']);
    expect(
      describePhoneCapabilities(
        status({ a11y: { enabled: true, connected: true, canScreenshot: true } }),
      ),
    ).toEqual(['读屏', '点按/输入', '截屏']);
    expect(
      describePhoneCapabilities(
        status({
          shell: {
        enabled: true,
        installed: true,
        running: true,
        wirelessDebugging: true,
        permission: 'granted',
      },
        }),
      ),
    ).toEqual(['shell']);
  });
});