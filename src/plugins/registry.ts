import type { PrecheckPlugin, PrecheckResult, PluginContext } from "../core/types.js";

export class PluginRegistry {
  private readonly plugins = new Map<string, PrecheckPlugin>();

  register(plugin: PrecheckPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): PrecheckPlugin | undefined {
    return this.plugins.get(id);
  }

  async run(
    pluginIds: string[],
    context: PluginContext
  ): Promise<PrecheckResult[]> {
    const results: PrecheckResult[] = [];
    for (const pluginId of pluginIds) {
      const plugin = this.plugins.get(pluginId);
      if (plugin?.supports(context.task)) {
        results.push(await plugin.run(context));
      }
    }
    return results;
  }
}
