// swagger.ts
import swaggerAutogen from 'swagger-autogen';

const doc = {
  info: {
    title: 'Keeto API',
    description: 'Generated API Documentation',
  },
  host: 'localhost:3000',
  schemes: ['http'],
  securityDefinitions: {
    bearerAuth: {
      type: 'apiKey',
      name: 'Authorization',
      scheme: 'bearer',
      in: 'header',
    },
  },
};

const outputFile = './swagger-output.json';
const endpointsFiles = ['./src/server.ts']; // المدخل الرئيسي للكود

// تشغيل المولد
swaggerAutogen()(outputFile, endpointsFiles, doc).then(() => {
    console.log("✅ Swagger output file generated");
});