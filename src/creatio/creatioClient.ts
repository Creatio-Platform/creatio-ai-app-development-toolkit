import axios, { AxiosInstance } from 'axios';
import { config } from '../config/env.js';

/**
 * Creatio REST API client with authentication and session management
 */
export class CreatioClient {
  private axiosInstance: AxiosInstance;
  private isAuthenticated = false;
  private cookies: string[] = [];

  constructor(
    private baseUrl: string = config.creatio.url,
    private username: string = config.creatio.username,
    private password: string = config.creatio.password,
  ) {
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      withCredentials: true,
    });

    // Intercept responses to capture cookies
    this.axiosInstance.interceptors.response.use(
      (response) => {
        if (response.headers['set-cookie']) {
          this.cookies = response.headers['set-cookie'];
        }
        return response;
      },
      (error) => error,
    );
  }

  /**
   * Authenticate with Creatio instance and establish session
   */
  async authenticate(): Promise<boolean> {
    try {
      const response = await this.axiosInstance.post('/ServiceModel/AuthService.svc/Login', {
        UserName: this.username,
        UserPassword: this.password,
      });

      if (response.data?.Code === 0 || response.status === 200) {
        this.isAuthenticated = true;
        return true;
      }

      throw new Error(`Authentication failed: ${response.data?.Message || 'Unknown error'}`);
    } catch (error: any) {
      console.error('Creatio authentication error:', error.message);
      throw new Error(`Failed to authenticate: ${error.message}`);
    }
  }

  /**
   * Ensure authentication before making requests
   */
  private async ensureAuthenticated(): Promise<void> {
    if (!this.isAuthenticated) {
      await this.authenticate();
    }
  }

  /**
   * Make authenticated POST request to Creatio API
   * Automatically re-authenticates on 401 errors
   */
  async post<T = any>(endpoint: string, data: any): Promise<T> {
    return this.makeRequest(endpoint, data, false);
  }

  /**
   * Internal method to make requests with retry logic
   */
  private async makeRequest<T = any>(endpoint: string, data: any, isRetry: boolean): Promise<T> {
    await this.ensureAuthenticated();

    try {
      // Build URL based on endpoint type
      let url: string;
      if (endpoint.startsWith('http')) {
        url = endpoint;
      } else if (endpoint.startsWith('ServiceModel/')) {
        // ServiceModel endpoints need /0/ prefix
        url = `${config.creatio.url}/0/${endpoint}`;
      } else if (endpoint.startsWith('/')) {
        // Absolute path from baseUrl
        url = `${config.creatio.url}${endpoint}`;
      } else {
        // Default: ClientUnitSchemaDesignerService endpoint
        url = `${config.creatio.url}${config.creatio.serviceEndpoint}${endpoint}`;
      }

      // Log the full URL being called
      console.log(`[CreatioClient] POST ${url}`);

      // Extract CSRF token from cookies for anti-forgery protection
      const csrfCookie = this.cookies.find((c) => c.includes('CRT_CSRF=') || c.includes('BPMCSRF='));
      const csrfToken = csrfCookie
        ?.split(';')[0]
        .split('=')[1];

      const headers: any = {
        Cookie: this.cookies.join('; '),
        'Content-Type': 'application/json',
      };

      // Add CSRF token header for POST requests (Creatio requires this)
      if (csrfToken) {
        headers['BPMCSRF'] = csrfToken;
      }

      const response = await this.axiosInstance.post(url, data, {
        headers,
        validateStatus: (status) => status < 500, // Accept any status < 500 as valid
      });

      console.log(`[CreatioClient] Response ${response.status}:`, response.data);

      // Handle 401 Unauthorized - session expired
      if (response.status === 401 && !isRetry) {
        console.log('[CreatioClient] Session expired (401), re-authenticating...');
        this.isAuthenticated = false;
        this.cookies = [];
        // Retry once after re-authentication
        return this.makeRequest(endpoint, data, true);
      }

      if (response.data?.success === false) {
        throw new Error(response.data?.message || response.data?.errorInfo?.message || 'API request failed');
      }

      return response.data;
    } catch (error: any) {
      console.error(`[CreatioClient] POST error (${endpoint}):`, error.message);
      if (error.response) {
        console.error('[CreatioClient] Error response:', error.response?.status, error.response?.data);
      }
      throw new Error(`API request failed: ${error.message}`);
    }
  }

  /**
   * Make authenticated GET request to Creatio API
   */
  async get<T = any>(endpoint: string, params?: any): Promise<T> {
    return this.makeGetRequest(endpoint, params, false);
  }

  /**
   * Internal method to make GET requests with retry logic
   */
  private async makeGetRequest<T = any>(endpoint: string, params: any, isRetry: boolean): Promise<T> {
    await this.ensureAuthenticated();

    try {
      // Build URL based on endpoint type (same logic as POST)
      let url: string;
      if (endpoint.startsWith('http')) {
        url = endpoint;
      } else if (endpoint.startsWith('ServiceModel/')) {
        url = `${config.creatio.url}/0/${endpoint}`;
      } else if (endpoint.startsWith('/')) {
        url = `${config.creatio.url}${endpoint}`;
      } else {
        url = `${config.creatio.url}${config.creatio.serviceEndpoint}${endpoint}`;
      }

      console.log(`[CreatioClient] GET ${url}`);

      const response = await this.axiosInstance.get(url, {
        params,
        headers: {
          Cookie: this.cookies.join('; '),
        },
        validateStatus: (status) => status < 500,
      });

      console.log(`[CreatioClient] Response ${response.status}:`, response.data);

      if (response.status === 401 && !isRetry) {
        console.log('[CreatioClient] Session expired (401) for GET, re-authenticating...');
        this.isAuthenticated = false;
        this.cookies = [];
        return this.makeGetRequest(endpoint, params, true);
      }

      if (response.data?.success === false) {
        throw new Error(response.data?.message || response.data?.errorInfo?.message || 'API request failed');
      }

      return response.data;
    } catch (error: any) {
      console.error(`Creatio GET error (${endpoint}):`, error.message);
      throw new Error(`API request failed: ${error.message}`);
    }
  }

  /**
   * Check if client is authenticated
   */
  isConnected(): boolean {
    return this.isAuthenticated;
  }
}

// Singleton instance
let creatioClientInstance: CreatioClient | null = null;

/**
 * Get singleton CreatioClient instance
 */
export function getCreatioClient(): CreatioClient {
  if (!creatioClientInstance) {
    creatioClientInstance = new CreatioClient();
  }
  return creatioClientInstance;
}
