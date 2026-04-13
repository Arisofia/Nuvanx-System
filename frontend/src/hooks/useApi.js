import { useState, useCallback } from 'react';
import api from '../config/api';

export function useApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const request = useCallback(async (method, url, data = null, options = {}) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api({ method, url, data, ...options });
      return res.data;
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Request failed';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const get = useCallback((url, options) => request('GET', url, null, options), [request]);
  const post = useCallback((url, data, options) => request('POST', url, data, options), [request]);
  const put = useCallback((url, data, options) => request('PUT', url, data, options), [request]);
  const del = useCallback((url, options) => request('DELETE', url, null, options), [request]);

  return { loading, error, get, post, put, del, request };
}
