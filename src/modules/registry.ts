import { pageModuleSchema, type PageModule } from '@/page/modules'

import { GenerationBlockedError as GenerationBlockedErrorClass } from './errors'
import { CaseModuleGenerator } from './generators/case'
import { ComparisonModuleGenerator } from './generators/comparison'
import { FaqModuleGenerator } from './generators/faq'
import { PromptModuleGenerator } from './generators/prompt'
import { TutorialModuleGenerator } from './generators/tutorial'

export interface ModuleGenerator {
  generate(input: unknown): Promise<PageModule>
}

export { GenerationBlockedError } from './errors'

export class ModuleRegistry {
  #generators = new Map<PageModule['module_type'], ModuleGenerator>()

  register(type: PageModule['module_type'], generator: ModuleGenerator): void {
    this.#generators.set(type, generator)
  }

  async generate(type: PageModule['module_type'], input: unknown): Promise<PageModule> {
    const generator = this.#generators.get(type)
    if (generator === undefined) throw new GenerationBlockedErrorClass(`unsupported_module:${type}`)
    return pageModuleSchema.parse(await generator.generate(input))
  }
}

export const createModuleRegistry = (): ModuleRegistry => {
  const registry = new ModuleRegistry()
  registry.register('prompt', new PromptModuleGenerator())
  registry.register('case', new CaseModuleGenerator())
  registry.register('tutorial', new TutorialModuleGenerator())
  registry.register('comparison', new ComparisonModuleGenerator())
  registry.register('faq', new FaqModuleGenerator())
  return registry
}
