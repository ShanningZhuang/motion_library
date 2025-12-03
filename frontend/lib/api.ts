import axios from 'axios';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle 401 errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

export interface LoginRequest {
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface TrajectoryMetadata {
  id: string;
  filename: string;
  category?: string;
  file_size: number;
  upload_date: string;
  frame_count?: number;
  frame_rate?: number;
  num_joints?: number;
  thumbnail_path?: string;
}

export interface ModelMetadata {
  id: string;
  filename: string;
  model_name?: string;
  relative_path: string;
  file_size: number;
  upload_date: string;
  thumbnail_path?: string;
}

// Auth API
export const authApi = {
  login: async (password: string): Promise<TokenResponse> => {
    const response = await api.post<TokenResponse>('/api/auth/login', { password });
    return response.data;
  },
  verify: async (): Promise<{ valid: boolean; user: string }> => {
    const response = await api.post('/api/auth/verify');
    return response.data;
  },
};

// Trajectory API
export const trajectoryApi = {
  list: async (category?: string): Promise<{ trajectories: TrajectoryMetadata[]; total: number }> => {
    const response = await api.get('/api/trajectories', { params: { category } });
    return response.data;
  },
  get: async (id: string): Promise<Blob> => {
    const response = await api.get(`/api/trajectories/${id}`, {
      responseType: 'blob',
    });
    return response.data;
  },
  upload: async (file: File, category?: string): Promise<any> => {
    const formData = new FormData();
    formData.append('file', file);
    if (category) {
      formData.append('category', category);
    }
    const response = await api.post('/api/trajectories', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/trajectories/${id}`);
  },
  getThumbnail: async (id: string): Promise<Blob> => {
    const response = await api.get(`/api/trajectories/${id}/thumbnail`, {
      responseType: 'blob',
    });
    return response.data;
  },
};

// Model API
export const modelApi = {
  list: async (): Promise<{ models: ModelMetadata[]; total: number }> => {
    const response = await api.get('/api/models');
    return response.data;
  },
  get: async (id: string): Promise<Blob> => {
    const response = await api.get(`/api/models/${id}`, {
      responseType: 'blob',
    });
    return response.data;
  },
  upload: async (file: File): Promise<any> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post('/api/models', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/models/${id}`);
  },
  listFiles: async (id: string): Promise<string[]> => {
    const response = await api.get(`/api/models/${id}/files`);
    return response.data.files;
  },
  getFile: async (id: string, filePath: string): Promise<Blob> => {
    const response = await api.get(`/api/models/${id}/files/${encodeURIComponent(filePath)}`, {
      responseType: 'blob',
    });
    return response.data;
  },
  getThumbnail: async (id: string): Promise<Blob> => {
    const response = await api.get(`/api/models/${id}/thumbnail`, {
      responseType: 'blob',
    });
    return response.data;
  },
};
