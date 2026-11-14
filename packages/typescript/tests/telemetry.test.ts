import { TelemetryService } from '../src/telemetry';

describe('TelemetryService', () => {
  test('its flush timer does not keep a Node process alive', () => {
    const telemetry = new TelemetryService('https://example.test', 'sdk_test', true);
    const timer = (telemetry as any).timer as NodeJS.Timeout;
    expect(timer).toBeTruthy();
    expect(timer.hasRef()).toBe(false);
    telemetry.stop();
  });
});
