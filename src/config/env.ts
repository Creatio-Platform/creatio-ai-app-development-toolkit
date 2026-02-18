import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  openaiApiKey: process.env.OPENAI_API_KEY,
  creatio: {
    url: process.env.CREATIO_URL || '',
    username: process.env.CREATIO_USERNAME || '',
    password: process.env.CREATIO_PASSWORD || '',
    // Note: Page Designer uses /0/ prefix for ClientUnitSchemaDesignerService
    serviceEndpoint: '/0/ServiceModel/ClientUnitSchemaDesignerService.svc/',
  },
};
