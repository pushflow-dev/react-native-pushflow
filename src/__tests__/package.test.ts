import { describe, expect, it } from '@jest/globals';
import { version } from '../../package.json';
import { SDK_VERSION } from '../version';

describe('npm package', () => {
  it('reports the published version in events and installations', () => {
    expect(SDK_VERSION).toBe(version);
  });
});
