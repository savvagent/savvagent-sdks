// Mock Angular core for testing

export function NgModule(config: any): ClassDecorator {
  return (target: any) => target;
}

export function Injectable(config?: any): ClassDecorator {
  return (target: any) => target;
}

export function Inject(token: any): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {};
}

export function Optional(): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {};
}

export function OnDestroy(): void {}

export class InjectionToken<T> {
  constructor(public description: string, options?: any) {}
}

export interface ModuleWithProviders<T = any> {
  ngModule: any;
  providers?: any[];
}
