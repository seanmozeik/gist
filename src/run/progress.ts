export interface ProgressGate {
  setClearProgressBeforeStdout: (fn: (() => undefined | (() => void)) | null) => void;
  clearProgressForStdout: () => void;
  restoreProgressAfterStdout: () => void;
  clearProgressIfCurrent: (fn: () => void) => void;
}

export function createProgressGate(): ProgressGate {
  let clearFn: (() => undefined | (() => void)) | null = null;
  let restoreFn: (() => void) | null = null;

  return {
    clearProgressForStdout: () => {
      if (!clearFn) {return;}
      const restore = clearFn();
      if (typeof restore === 'function') {
        restoreFn = restore;
      } else {
        restoreFn = null;
      }
    },
    clearProgressIfCurrent: (fn) => {
      if (clearFn === fn) {
        clearFn = null;
        restoreFn = null;
      }
    },
    restoreProgressAfterStdout: () => {
      if (!restoreFn) {return;}
      const restore = restoreFn;
      restoreFn = null;
      restore();
    },
    setClearProgressBeforeStdout: (fn) => {
      clearFn = fn;
      restoreFn = null;
    },
  };
}
