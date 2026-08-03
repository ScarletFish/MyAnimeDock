// Declaration for the `process.pkg` flag injected by @yao-pkg/pkg at runtime.
declare namespace NodeJS {
  interface Process {
    pkg?: boolean;
  }
}