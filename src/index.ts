// npm entry: the JSR entry plus the `ContextVariableMap` augmentation, which
// JSR rejects (see augment.ts).
import "./augment.ts";

export * from "./mod.ts";
