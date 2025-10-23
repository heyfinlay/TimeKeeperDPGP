import { createContext, useContext } from 'react';

const AuthContext = createContext({
  user: null,
  isLoading: false,
  permissions: {
    isAdmin: false,
    isMarshal: false,
  },
});

export const AuthProvider = ({ children, value }) => {
  const mergedValue = {
    user: null,
    isLoading: false,
    ...value,
    permissions: {
      isAdmin: false,
      isMarshal: false,
      ...(value?.permissions ?? {}),
    },
  };

  return <AuthContext.Provider value={mergedValue}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);

export default AuthContext;
