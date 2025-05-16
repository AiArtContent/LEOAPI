const express = require('express');
const axios = require('axios');
require('dotenv').config(); // Для локальной разработки с .env файлом

const app = express();
app.use(express.json()); // Middleware для парсинга JSON-тела входящих запросов

const LEONARDO_API_BASE_URL = 'https://cloud.leonardo.ai/api/rest/v1';

// --- Хелперы для логирования и ответа ошибкой ---
function logLeonardoError(err, context) {
  console.error(`Error calling Leonardo AI API (${context}):`);
  if (err.response) {
    console.error('Leonardo AI Response Data:', JSON.stringify(err.response.data, null, 2));
    console.error('Leonardo AI Response Status:', err.response.status);
    console.error('Leonardo AI Response Headers:', JSON.stringify(err.response.headers, null, 2));
  } else if (err.request) {
    console.error('No response received from Leonardo AI (request made):', err.request);
  } else {
    console.error('Error setting up request to Leonardo AI:', err.message);
  }
}

function sendErrorResponse(res, clientErrorMessage, err) {
  const statusCode = err.response ? err.response.status : 500;
  const errorDetails = err.response ? err.response.data : { message: err.message };
  res.status(statusCode || 500).json({
    error: clientErrorMessage,
    details: errorDetails
  });
}
// --- Конец хелперов ---


// Эндпоинт для ЗАПУСКА генерации
app.post('/generate', async (req, res) => {
  const { prompt, width, height } = req.body; // Получаем основные параметры от клиента

  if (!prompt || !width || !height) {
    return res.status(400).json({ error: 'Missing required parameters: prompt, width, or height' });
  }

  // --- Формируем тело запроса для API Leonardo.Ai ---
  const leonardoPayload = {
    prompt: prompt,
    modelId: "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3", // ID для Phoenix (из примера, который ты предоставил)
    width: parseInt(width, 10),
    height: parseInt(height, 10),
    num_images: 1,            // Генерируем 1 изображение
    alchemy: true,            // Как в примере
    contrast: 3.5,            // Как в примере

    // Используем styleUUID из примера и enhancePrompt: true согласно твоим пожеланиям
    styleUUID: "111dc692-d470-4eec-b791-3475abac4c46", 
    enhancePrompt: true       // Установлено в true
                               // Убедись, что API Leonardo действительно ожидает параметр с именем "enhancePrompt"
  };
  // ----------------------------------------------------

  console.log(`[${new Date().toISOString()}] Received /generate request. Prompt: "${prompt}", Width: ${width}, Height: ${height}`);
  console.log('Sending payload to Leonardo AI:', JSON.stringify(leonardoPayload, null, 2));

  try {
    const apiResponse = await axios.post(
      `${LEONARDO_API_BASE_URL}/generations`,
      leonardoPayload,
      {
        headers: {
          'accept': 'application/json',
          'authorization': `Bearer ${process.env.LEONARDO_API_KEY}`,
          'content-type': 'application/json'
        }
      }
    );

    if (apiResponse.data && apiResponse.data.sdGenerationJob && apiResponse.data.sdGenerationJob.generationId) {
      const generationId = apiResponse.data.sdGenerationJob.generationId;
      console.log(`Leonardo AI job successfully started. Generation ID: ${generationId}`);
      res.status(202).json({ generationId }); // Статус 202 Accepted
    } else {
      console.warn('Unexpected success response structure from Leonardo AI POST /generations:', apiResponse.data);
      // Попытка найти URL, если он вдруг вернулся сразу
      let imageUrls = [];
      if (apiResponse.data && apiResponse.data.generations && Array.isArray(apiResponse.data.generations)) {
          apiResponse.data.generations.forEach(gen => {
              if (gen.generated_images && Array.isArray(gen.generated_images)) {
                  gen.generated_images.forEach(img => { if (img.url) imageUrls.push(img.url); });
              }
          });
      }
      if (imageUrls.length > 0) {
          console.log('Leonardo AI returned image URL(s) directly in /generations response:', imageUrls[0]);
          res.json({ url: imageUrls[0], status: 'COMPLETE_IMMEDIATELY' });
      } else {
          res.status(500).json({ error: 'Unexpected response structure from image generation service after job start', details: apiResponse.data });
      }
    }

  } catch (err) {
    logLeonardoError(err, 'POST /generations');
    sendErrorResponse(res, 'Failed to start image generation with Leonardo AI', err);
  }
});


// Эндпоинт для ПОЛУЧЕНИЯ РЕЗУЛЬТАТА генерации по ID
app.get('/result/:id', async (req, res) => {
  const generationId = req.params.id;
  if (!generationId) {
    return res.status(400).json({ error: 'Missing generationId parameter' });
  }
  console.log(`[${new Date().toISOString()}] Received /result request for Generation ID: ${generationId}`);

  try {
    const apiResponse = await axios.get(
      `${LEONARDO_API_BASE_URL}/generations/${generationId}`,
      {
        headers: {
          'accept': 'application/json',
          'authorization': `Bearer ${process.env.LEONARDO_API_KEY}`
        }
      }
    );

    const generationDetails = apiResponse.data && apiResponse.data.generations_by_pk;

    if (generationDetails) {
      const status = generationDetails.status;
      console.log(`Status for Generation ID ${generationId}: ${status}`);

      if (status === 'COMPLETE') {
        if (generationDetails.generated_images && Array.isArray(generationDetails.generated_images) && generationDetails.generated_images.length > 0) {
          const validImageUrls = generationDetails.generated_images
            .map(img => img.url)
            .filter(url => url != null && url.startsWith('http'));

          if (validImageUrls.length > 0) {
            console.log(`Image(s) ready for ${generationId}:`, validImageUrls);
            res.json({ status: 'COMPLETE', url: validImageUrls[0], allUrls: validImageUrls });
          } else {
            console.error(`Generation COMPLETE for ${generationId} but no valid URLs found:`, generationDetails.generated_images);
            res.status(404).json({ status: 'COMPLETE_NO_VALID_URLS', error: 'Generation complete but no valid image URLs found' });
          }
        } else {
          console.error(`Generation COMPLETE for ${generationId} but 'generated_images' array is missing or empty:`, generationDetails);
          res.status(404).json({ status: 'COMPLETE_NO_IMAGES_ARRAY', error: 'Generation complete but image data is missing' });
        }
      } else if (status === 'PENDING' || status === 'PROCESSING') {
        console.log(`Generation ${generationId} is still ${status}.`);
        res.json({ status: status });
      } else if (status === 'FAILED') {
        const failureReason = generationDetails.failureReason || 'Unknown reason';
        console.error(`Leonardo AI generation FAILED for ID ${generationId}. Reason: ${failureReason}`, generationDetails);
        res.status(500).json({ status: 'FAILED', error: 'Image generation failed at Leonardo AI', details: failureReason });
      } else {
        console.warn(`Unknown or unexpected status for ${generationId}: ${status}`, generationDetails);
        res.status(500).json({ error: 'Unknown status or unexpected response from Leonardo AI (get result)', status: status, details: generationDetails });
      }
    } else {
      // Если нет `generations_by_pk`, пробуем более общую структуру из документации "array of URL links"
      let foundUrls = [];
      if (apiResponse.data && apiResponse.data.generated_images && Array.isArray(apiResponse.data.generated_images)) {
           foundUrls = apiResponse.data.generated_images.map(img => img.url).filter(url => url != null && url.startsWith('http'));
      } else if (apiResponse.data && Array.isArray(apiResponse.data) && apiResponse.data.length > 0 && apiResponse.data[0].url) {
           // Если сам ответ - это массив объектов изображений
           foundUrls = apiResponse.data.map(img => img.url).filter(url => url != null && url.startsWith('http'));
      }

      if (foundUrls.length > 0) {
          console.log(`Image(s) ready for ${generationId} (found via alternative/direct structure):`, foundUrls);
          res.json({ status: 'COMPLETE', url: foundUrls[0], allUrls: foundUrls });
      } else {
          console.error('Unexpected response structure from Leonardo AI GET /generations/:id (missing generations_by_pk and direct URLs):', apiResponse.data);
          res.status(404).json({ error: 'Result not found or unexpected response structure from Leonardo AI (get result)', details: apiResponse.data });
      }
    }

  } catch (err) {
    logLeonardoError(err, `GET /generations/${generationId}`);
    sendErrorResponse(res, 'Failed to fetch image result from Leonardo AI', err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`LEOAPI Server successfully running on port ${PORT}`);
});
