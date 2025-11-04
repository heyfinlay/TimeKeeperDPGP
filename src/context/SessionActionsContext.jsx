import { createContext, useContext, useMemo } from 'react';

const noopPromise = async () => undefined;

const DEFAULT_VALUE = {
  onLogLap: null,
  invalidateLastLap: noopPromise,
  setFlagState: noopPromise,
  setProcedurePhase: noopPromise,
  canWrite: false,
};

const SessionActionsContext = createContext(DEFAULT_VALUE);

export function SessionActionsProvider({ value, children }) {
  const memoisedValue = useMemo(() => {
    if (!value) {
      return DEFAULT_VALUE;
    }
    return {
      ...DEFAULT_VALUE,
      ...value,
      onLogLap: value.onLogLap ?? DEFAULT_VALUE.onLogLap,
      invalidateLastLap: value.invalidateLastLap ?? DEFAULT_VALUE.invalidateLastLap,
      setFlagState: value.setFlagState ?? DEFAULT_VALUE.setFlagState,
      setProcedurePhase: value.setProcedurePhase ?? DEFAULT_VALUE.setProcedurePhase,
      canWrite: Boolean(value.canWrite ?? DEFAULT_VALUE.canWrite),
    };
  }, [value]);

  return <SessionActionsContext.Provider value={memoisedValue}>{children}</SessionActionsContext.Provider>;
}

export function useSessionActions() {
  return useContext(SessionActionsContext);
}