import React, { createContext, useContext, useState, useEffect } from 'react';
import { adminAuthService, authService } from '../services/api';
import { AUTH_MODE } from '../utils/authMode.js';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(AUTH_MODE === 'cookie' ? null : sessionStorage.getItem('xora_token') || null);
  const [loading, setLoading] = useState(true);

  // Initialize and load user
  useEffect(() => {
    const initializeAuth = async () => {
      localStorage.removeItem('xora_token');
      localStorage.removeItem('xora_user');
      const storedToken = sessionStorage.getItem('xora_token');
      if (AUTH_MODE === 'cookie' || storedToken) {
        try {
          const res = await authService.getProfile();
          if (res.data.success) {
            setUser(res.data.user);
          }
        } catch (error) {
          if (error.response?.status !== 401) console.warn('Unable to verify the current session.');
          sessionStorage.removeItem('xora_token');
          sessionStorage.removeItem('xora_user');
          setToken(null);
          setUser(null);
        }
      }
      setLoading(false);
    };

    initializeAuth();
  }, []);

  const login = async (email, password, rememberMe = false) => {
    if (rememberMe) {
      return {
        success: false,
        message: 'Remember Me needs secure persistent-session support from the server. Please sign in with Remember Me unchecked for now.'
      };
    }

    try {
      const res = await authService.login({ email, password });
      if (res.data.success) {
        if (res.data.authMode && res.data.authMode !== AUTH_MODE) {
          return { success: false, message: 'Frontend and backend authentication modes do not match.' };
        }
        const { token: newToken, user: userData } = res.data;
        if (AUTH_MODE === 'bearer' && typeof newToken !== 'string') {
          return { success: false, message: 'The backend did not return a bearer session.' };
        }
        if (AUTH_MODE === 'bearer') sessionStorage.setItem('xora_token', newToken);
        else sessionStorage.removeItem('xora_token');
        sessionStorage.setItem('xora_user', JSON.stringify(userData));
        setToken(AUTH_MODE === 'cookie' ? null : newToken);
        setUser(userData);
        return { success: true, user: userData };
      }
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Login failed. Please check credentials.'
      };
    }
  };

  const register = async (name, email, password, confirmPassword) => {
    try {
      const res = await authService.register({ name, email, password, confirmPassword });
      if (res.data.success) {
        if (res.data.authMode && res.data.authMode !== AUTH_MODE) {
          return { success: false, message: 'Frontend and backend authentication modes do not match.' };
        }
        const { token: newToken, user: userData } = res.data;
        if (AUTH_MODE === 'bearer' && typeof newToken !== 'string') {
          return { success: false, message: 'The backend did not return a bearer session.' };
        }
        if (AUTH_MODE === 'bearer') sessionStorage.setItem('xora_token', newToken);
        else sessionStorage.removeItem('xora_token');
        sessionStorage.setItem('xora_user', JSON.stringify(userData));
        setToken(AUTH_MODE === 'cookie' ? null : newToken);
        setUser(userData);
        return { success: true, user: userData };
      }
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Registration failed.'
      };
    }
  };

  const completeAdminLogin = async ({ challengeToken, code, recoveryCode }) => {
    try {
      const response = await adminAuthService.verifyMfa({ challengeToken, code, recoveryCode });
      if (!response.data.success) return { success: false, message: 'Administrator verification failed.' };
      if (response.data.authMode && response.data.authMode !== AUTH_MODE) {
        return { success: false, message: 'Frontend and backend authentication modes do not match.' };
      }
      const { token: newToken, user: userData, recoveryCodes } = response.data;
      if (AUTH_MODE === 'bearer' && typeof newToken !== 'string') {
        return { success: false, message: 'The backend did not return an administrator session.' };
      }
      if (AUTH_MODE === 'bearer') sessionStorage.setItem('xora_token', newToken);
      else sessionStorage.removeItem('xora_token');
      sessionStorage.setItem('xora_user', JSON.stringify(userData));
      setToken(AUTH_MODE === 'cookie' ? null : newToken);
      setUser(userData);
      return { success: true, user: userData, recoveryCodes };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Administrator verification failed.'
      };
    }
  };

  const logout = () => {
    const currentToken = sessionStorage.getItem('xora_token');
    if (AUTH_MODE === 'cookie' || currentToken) authService.logout(currentToken).catch(() => {});
    sessionStorage.removeItem('xora_token');
    sessionStorage.removeItem('xora_user');
    localStorage.removeItem('xora_token');
    localStorage.removeItem('xora_user');
    setUser(null);
    setToken(null);
  };

  const updateUser = (updatedData) => {
    setUser((prev) => ({ ...prev, ...updatedData }));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAuthenticated: !!user,
        isAdmin: ['admin', 'owner'].includes(user?.role),
        login,
        register,
        completeAdminLogin,
        logout,
        updateUser
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
