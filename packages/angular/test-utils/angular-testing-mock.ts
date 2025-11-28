// Mock Angular testing utilities

class MockTestBed {
  private static providers: any[] = [];
  private static instances = new Map<any, any>();

  static configureTestingModule(config: { imports?: any[]; providers?: any[] }): typeof MockTestBed {
    this.providers = [];
    this.instances.clear();

    if (config.imports) {
      config.imports.forEach((imp) => {
        if (imp.providers) {
          this.providers.push(...imp.providers);
        }
      });
    }

    if (config.providers) {
      this.providers.push(...config.providers);
    }

    return this;
  }

  static inject<T>(token: any): T {
    if (this.instances.has(token)) {
      return this.instances.get(token);
    }

    // Find provider for token
    const provider = this.providers.find((p) => {
      if (typeof p === 'function') return p === token;
      if (p.provide) return p.provide === token;
      return false;
    });

    let instance: any;

    if (!provider) {
      // Try to instantiate the token itself
      if (typeof token === 'function') {
        const deps = this.getDependencies(token);
        instance = new token(...deps);
      } else {
        throw new Error(`No provider for ${token}`);
      }
    } else if (typeof provider === 'function') {
      const deps = this.getDependencies(provider);
      instance = new provider(...deps);
    } else if (provider.useValue !== undefined) {
      instance = provider.useValue;
    } else if (provider.useClass) {
      const deps = this.getDependencies(provider.useClass);
      instance = new provider.useClass(...deps);
    } else if (provider.useFactory) {
      instance = provider.useFactory();
    } else {
      const deps = this.getDependencies(provider.provide);
      instance = new provider.provide(...deps);
    }

    this.instances.set(token, instance);
    return instance;
  }

  private static getDependencies(target: any): any[] {
    // Look for providers that should be injected into the target
    const deps: any[] = [];

    // For services that expect config, find the config provider
    this.providers.forEach((p) => {
      if (typeof p === 'object' && p.provide && p.useValue !== undefined) {
        deps.push(p.useValue);
      }
    });

    return deps;
  }

  static resetTestingModule(): void {
    this.providers = [];
    this.instances.clear();
  }
}

export const TestBed = MockTestBed;
