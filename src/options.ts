import { MongoryInvalidOptionError } from "./errors.js";
import {
  Constructor,
  CustomOperator,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_NODES,
  MISSING,
  TypeGuard,
} from "./types.js";

const APPLY_OPTION = Symbol("mongory.applyOption");

export const BUILTIN_OPERATORS: ReadonlySet<string> = new Set([
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$in",
  "$nin",
  "$exists",
  "$present",
  "$and",
  "$or",
  "$not",
  "$elemMatch",
  "$every",
  "$size",
  "$regex",
  "$options",
]);

export interface ConverterEntry {
  guard: (value: unknown) => boolean;
  convert: (value: unknown) => unknown;
}

export interface FieldGetterEntry {
  guard?: (value: unknown) => boolean;
  get: (record: unknown) => unknown;
}

export interface FieldResolverEntry {
  guard?: (value: unknown) => boolean;
  resolve: (record: unknown, field: string) => unknown;
}

/**
 * Opaque option object passed to `compile` or `match`.
 */
export interface CompileOption {
  readonly [APPLY_OPTION]: (cfg: CompileConfig) => void;
}

export class CompileConfig {
  maxDepth = DEFAULT_MAX_DEPTH;
  maxNodes = DEFAULT_MAX_NODES;
  readonly optionErrors: string[] = [];
  readonly converters: ConverterEntry[] = [];
  readonly fieldGetters = new Map<string, FieldGetterEntry[]>();
  readonly fieldResolvers: FieldResolverEntry[] = [];
  readonly customOperators = new Map<string, CustomOperator>();

  addError(msg: string): void {
    this.optionErrors.push(msg);
  }

  hasExtensions(): boolean {
    return (
      this.converters.length > 0 ||
      this.fieldGetters.size > 0 ||
      this.fieldResolvers.length > 0 ||
      this.customOperators.size > 0
    );
  }

  hasConverters(): boolean {
    return this.converters.length > 0;
  }

  hasFieldHooks(): boolean {
    return this.fieldGetters.size > 0 || this.fieldResolvers.length > 0;
  }

  applyConverter(value: unknown): unknown {
    if (value === MISSING || value === null || value === undefined || this.converters.length === 0) {
      return value;
    }
    // Iterate newest-first so later options win on overlapping guards.
    for (let i = this.converters.length - 1; i >= 0; i--) {
      const entry = this.converters[i];
      if (entry.guard(value)) {
        return entry.convert(value);
      }
    }
    return value;
  }

  resolveCustomField(record: object, field: string): { handled: boolean; value: unknown } {
    const getters = this.fieldGetters.get(field);
    if (getters) {
      for (let i = getters.length - 1; i >= 0; i--) {
        const g = getters[i];
        if (!g.guard || g.guard(record)) {
          const v = g.get(record);
          return { handled: true, value: v === undefined ? MISSING : v };
        }
      }
    }
    for (let i = this.fieldResolvers.length - 1; i >= 0; i--) {
      const r = this.fieldResolvers[i];
      if (!r.guard || r.guard(record)) {
        const res = r.resolve(record, field);
        if (res !== undefined) {
          return { handled: true, value: res };
        }
      }
    }
    return { handled: false, value: MISSING };
  }
}

function makeOption(apply: (cfg: CompileConfig) => void): CompileOption {
  return { [APPLY_OPTION]: apply };
}

function isConstructorTarget(fn: unknown): fn is Constructor {
  if (typeof fn !== "function") {
    return false;
  }
  const desc = Object.getOwnPropertyDescriptor(fn, "prototype");
  if (!desc) {
    return false;
  }
  // ES6+ classes and standard built-ins always define a non-writable .prototype.
  if (desc.writable === false) {
    return true;
  }
  const proto = fn.prototype as object | null | undefined;
  if (typeof proto === "object" && proto !== null) {
    if (Object.getOwnPropertyNames(proto).length > 1 || Object.getOwnPropertySymbols(proto).length > 0) {
      return true;
    }
  }
  return false;
}

function toTypePredicate(target: unknown, optionName: string, cfg: CompileConfig): ((v: unknown) => boolean) | undefined {
  if (typeof target !== "function") {
    cfg.addError(`${optionName} target must be a class constructor or type-guard function`);
    return undefined;
  }
  if (target === Object) {
    cfg.addError(`${optionName} does not allow Object as a catch-all type`);
    return undefined;
  }
  if (isConstructorTarget(target)) {
    return (v: unknown) => v instanceof target;
  }
  return target as (v: unknown) => boolean;
}

/**
 * Bundles multiple compile options into a reusable preset, applying them from
 * left to right (later options override earlier duplicates). Null/undefined entries
 * are ignored.
 */
export function withOptions(...options: Array<CompileOption | null | undefined>): CompileOption {
  const snapshot = options.slice();
  return makeOption((cfg) => {
    for (const opt of snapshot) {
      applySingleOption(cfg, opt);
    }
  });
}

/**
 * Overrides the default condition nesting depth limit (`64`).
 * A value `<= 0` disables the depth limit.
 */
export function withMaxDepth(depth: number): CompileOption {
  return makeOption((cfg) => {
    if (typeof depth !== "number" || !Number.isInteger(depth)) {
      cfg.addError(`withMaxDepth requires an integer, got ${String(depth)}`);
      return;
    }
    cfg.maxDepth = depth;
  });
}

/**
 * Overrides the default compiled AST node limit (`4096`).
 * A value `<= 0` disables the node limit.
 */
export function withMaxNodes(nodes: number): CompileOption {
  return makeOption((cfg) => {
    if (typeof nodes !== "number" || !Number.isInteger(nodes)) {
      cfg.addError(`withMaxNodes requires an integer, got ${String(nodes)}`);
      return;
    }
    cfg.maxNodes = nodes;
  });
}

/**
 * Registers a compile-scoped value converter for a class constructor or type guard.
 * Applied once at comparison points on records and during normalization on built-in
 * condition arguments (preserving raw arguments passed to custom operators).
 */
export function withConverter<T extends object>(
  ctor: Constructor<T>,
  convert: (value: T) => unknown,
): CompileOption;
export function withConverter<T>(
  guard: TypeGuard<T>,
  convert: (value: T) => unknown,
): CompileOption;
export function withConverter(
  target: Constructor | TypeGuard<unknown>,
  convert: (value: never) => unknown,
): CompileOption {
  return makeOption((cfg) => {
    const guard = toTypePredicate(target, "withConverter", cfg);
    if (!guard) {
      return;
    }
    if (typeof convert !== "function") {
      cfg.addError("withConverter converter must be a function");
      return;
    }
    cfg.converters.push({
      guard,
      convert: convert as (value: unknown) => unknown,
    });
  });
}

/**
 * Registers a custom field getter scoped to this compile call, optionally
 * restricted to records matching a class constructor or type guard.
 * Precedence: `withField` > `withFieldResolver` > own object property.
 */
export function withField<T = Record<string, unknown>>(
  name: string,
  getter: (record: T) => unknown,
): CompileOption;
export function withField<T extends object>(
  target: Constructor<T> | TypeGuard<T>,
  name: string,
  getter: (record: T) => unknown,
): CompileOption;
export function withField(
  arg1: string | Constructor | TypeGuard<unknown>,
  arg2: ((record: never) => unknown) | string,
  arg3?: (record: never) => unknown,
): CompileOption {
  return makeOption((cfg) => {
    let guard: ((v: unknown) => boolean) | undefined;
    let name: unknown;
    let getter: unknown;

    if (typeof arg1 === "string" && arg3 === undefined) {
      name = arg1;
      getter = arg2;
    } else {
      guard = toTypePredicate(arg1, "withField", cfg);
      if (!guard) {
        return;
      }
      name = arg2;
      getter = arg3;
    }

    if (typeof name !== "string" || name.length === 0) {
      cfg.addError("withField field name must be a non-empty string");
      return;
    }
    if (typeof getter !== "function") {
      cfg.addError(`withField(${JSON.stringify(name)}) getter must be a function`);
      return;
    }
    let list = cfg.fieldGetters.get(name);
    if (!list) {
      list = [];
      cfg.fieldGetters.set(name, list);
    }
    list.push({ guard, get: getter as (record: unknown) => unknown });
  });
}

/**
 * Registers a dynamic field resolver scoped to this compile call, optionally
 * restricted to records matching a class constructor or type guard.
 * Returning `undefined` falls through to earlier resolvers / own property lookup;
 * returning {@link MISSING} hides the field; any other value is used as the field value.
 */
export function withFieldResolver<T = Record<string, unknown>>(
  resolver: (record: T, field: string) => unknown,
): CompileOption;
export function withFieldResolver<T extends object>(
  target: Constructor<T> | TypeGuard<T>,
  resolver: (record: T, field: string) => unknown,
): CompileOption;
export function withFieldResolver(
  arg1: ((record: never, field: string) => unknown) | Constructor | TypeGuard<unknown>,
  arg2?: (record: never, field: string) => unknown,
): CompileOption {
  return makeOption((cfg) => {
    let guard: ((v: unknown) => boolean) | undefined;
    let resolver: unknown;

    if (arg2 === undefined) {
      resolver = arg1;
    } else {
      guard = toTypePredicate(arg1, "withFieldResolver", cfg);
      if (!guard) {
        return;
      }
      resolver = arg2;
    }

    if (typeof resolver !== "function") {
      cfg.addError("withFieldResolver resolver must be a function");
      return;
    }
    cfg.fieldResolvers.push({
      guard,
      resolve: resolver as (record: unknown, field: string) => unknown,
    });
  });
}

/**
 * Registers a custom `$`-prefixed operator scoped strictly to this compile call.
 * Cannot override built-in operators (`$eq`, `$regex`, etc.).
 */
export function withOperator(name: string, operator: CustomOperator): CompileOption {
  return makeOption((cfg) => {
    if (typeof name !== "string" || !name.startsWith("$") || name.length <= 1) {
      cfg.addError(`operator name ${JSON.stringify(name)} must start with "$"`);
      return;
    }
    if (BUILTIN_OPERATORS.has(name)) {
      cfg.addError(`cannot override built-in operator ${JSON.stringify(name)}`);
      return;
    }
    if (!operator || typeof operator.compile !== "function") {
      cfg.addError(`operator ${JSON.stringify(name)} has invalid compile function`);
      return;
    }
    cfg.customOperators.set(name, {
      compile: operator.compile,
      matchElements: Boolean(operator.matchElements),
      priority: operator.priority,
    });
  });
}

function applySingleOption(cfg: CompileConfig, opt: unknown): void {
  if (opt === null || opt === undefined) {
    return;
  }
  if (typeof opt !== "object" || typeof (opt as CompileOption)[APPLY_OPTION] !== "function") {
    cfg.addError("invalid compile option");
    return;
  }
  (opt as CompileOption)[APPLY_OPTION](cfg);
}

export function resolveCompileConfig(options: ReadonlyArray<CompileOption | null | undefined>): CompileConfig {
  const cfg = new CompileConfig();
  for (const opt of options) {
    applySingleOption(cfg, opt);
  }
  if (cfg.optionErrors.length > 0) {
    throw new MongoryInvalidOptionError(`mongory: invalid option: ${cfg.optionErrors.join("; ")}`);
  }
  return cfg;
}
