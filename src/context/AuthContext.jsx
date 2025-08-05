import { createContext, useState, useEffect } from 'react';
import { API_BASE_URL } from '../lib/axiosInstance';

const AuthContext = createContext();

export { AuthContext };

export const AuthProvider = ({ children }) => {
  // Persisted user information (if any) is loaded from localStorage first so that
  // we can immediately render the authenticated state. We will still validate the
  // token with the backend in the background.
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('authUser');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState(localStorage.getItem('authToken'));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Check if we're running in Electron
  const isElectron = window.electronAPI && window.electronAPI.req;

  // Handle OAuth callback in browser mode - simplified approach
  useEffect(() => {
    if (isElectron) return; // skip if running inside Electron
    
    // Check for token in URL parameters on any page
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    
    if (token) {
      // Store the token and set user as authenticated
      setToken(token);
      localStorage.setItem('authToken', token);
      
      // Fetch user info from backend using the token
      const fetchUserInfo = async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/auth/status`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          
          if (response.ok) {
            const data = await response.json();
            setUser(data.user);
            localStorage.setItem('authUser', JSON.stringify(data.user));
          }
        } catch (error) {
          console.error('Failed to fetch user info:', error);
        }
      };
      
      fetchUserInfo();
      
      // Clean up URL - navigate to home page
      window.history.replaceState({}, document.title, '/home');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the user object persisted so it survives full application restarts
  useEffect(() => {
    if (user) {
      try {
        localStorage.setItem('authUser', JSON.stringify(user));
      } catch (e) {
        console.error('Failed to persist authUser', e);
      }
    } else {
      localStorage.removeItem('authUser');
    }
  }, [user]);

  // Initialize authentication on mount
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        if (isElectron && window.electronAPI.req.auth) {
          // In Electron, check for stored token
          const tokenResult = await window.electronAPI.req.auth.getToken();
          if (tokenResult.status === 1 && tokenResult.token) {
            const authStatus = await window.electronAPI.req.auth.checkStatus();
            if (authStatus.status === 1) {
              setToken(tokenResult.token);
              setUser(authStatus.user);
            } else {
              // Token is invalid, clear it
              await window.electronAPI.req.auth.logout();
            }
          }
        } else if (token) {
          // In web browser, check if token is still valid
          // This would call your backend API
          console.log('Web token found:', token);
        }
      } catch (error) {
        console.error('Failed to initialize auth:', error);
        // Call logout function to clear state
        setUser(null);
        setToken(null);
        localStorage.removeItem('authToken');
        localStorage.removeItem('authUser');
        setError(null);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();
  }, [token, isElectron]);

  // Listen for login success from Electron
  useEffect(() => {
    if (isElectron && window.electronAPI.res.auth) {
      const handleLoginSuccess = (event, data) => {
        console.log('Login success received from Electron:', data);
        handleAuthSuccess(data);
      };

      window.electronAPI.res.auth.loginSuccess(handleLoginSuccess);

      return () => {
        // Cleanup listener if needed
      };
    }
  }, [isElectron]);

  const handleAuthSuccess = (authData) => {
    if (authData.access_token) {
      setToken(authData.access_token);
      setUser(authData.user);
      localStorage.setItem('authToken', authData.access_token);
      localStorage.setItem('authUser', JSON.stringify(authData.user));
      setError(null);
    }
  };

  const login = async () => {
    try {
      setError(null);
      setLoading(true);
      
      if (isElectron) {
        // In Electron, trigger the login flow through IPC
        if (window.electronAPI.req.auth) {
          const result = await window.electronAPI.req.auth.initiateLogin();
          if (result.status === 0) {
            throw new Error(result.error || 'Login failed');
          }
        } else {
          throw new Error('Authentication not available in Electron');
        }
      } else {
        // In web browser, redirect to Google OAuth - use web endpoint
        window.location.href = `${API_BASE_URL}/auth/web/google`;
      }
    } catch (error) {
      console.error('Login failed:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      if (isElectron && window.electronAPI.req.auth) {
        await window.electronAPI.req.auth.logout();
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
      setToken(null);
      localStorage.removeItem('authToken');
      localStorage.removeItem('authUser');
      setError(null);
    }
  };

  const value = {
    user,
    token,
    loading,
    error,
    login,
    logout,
    isAuthenticated: !!user && !!token,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}; 