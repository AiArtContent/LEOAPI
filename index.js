const express = require('express');
const axios = require('axios');
require('dotenv').config(); // Для локальной разработки с .env файлом

const app = express();
app.use(express.json()); // Middleware для парсинга JSON-тела входящих запросов

// Middleware для логирования ВСЕХ входящих запросов (для отладки)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] MIDDLEWARE: Received request: ${req.method} ${req.originalUrl}`);
  // Раскомментируй следующие строки, если нужно видеть заголовки или тело в логах от этого middleware
  // console.log('[MIDDLEWARE] Request Headers:', JSON.stringify(req.headers, null, 2));
  // if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
  //   console.log('[MIDDLEWARE] Request Body:', JSON.stringify(req.body, null, 2));
  // }
  next();
});

const LEONARDO_API_BASE_URL = 'https://cloud.leonardo.ai/api/rest/v1';

// --- Хелперы для логирования ошибок от Leonardo.Ai и отправки стандартизированного ответа клиенту ---
function logLeonardoError(err, context) {
  console.error(`Error calling Leonardo AI API (${context}):`);
  if (err.response) {
    console.error('Leonardo AI Response Status:', err.response.status);
    console.error('Leonardo AI Response Data:', JSON.stringify(err.response.data, null, 2));
  } else if (err.request) {
    console.error('No response received from Leonardo AI (request made).');
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


// Эндпоинт для ЗАПУСКА генерации изображения
app.post('/generate', async (req, res) => {
  // Логирование начала работы обработчика
  console.log(`[${new Date().toISOString()}] Handler for POST /generate CALLED!`);
  
  const { prompt, width, height } = req.body; // Получаем основные параметры от клиента
  console.log(`Received prompt: "${prompt}", width: ${width}, height: ${height}`);

  if (!prompt || !width || !height) {
    console.error('Missing required parameters in /generate request');
    return res.status(400).json({ error: 'Missing required parameters: prompt, width, or height' });
  }

  // --- Формируем тело запроса для API Leonardo.Ai ---
  // Используем параметры, которые ты подтвердил или которые были в примере для Phoenix
  const leonardoPayload = {
    prompt: prompt,
    modelId: "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3", // ID для Phoenix (из твоего примера документации)
    width: parseInt(width, 10),
    height: parseInt(height, 10),
    num_images: 1,            // Генерируем 1 изображение
    alchemy: true,            // Как в примере
    contrast: 3.5,            // Как в примере

    // Используем styleUUID из примера и enhancePrompt: true согласно твоим пожеланиям
    styleUUID: "111dc692-d470-4eec-b791-3475abac4c46", // UUID стиля из примера (ты подтвердил, что это для Dynamic)
    enhancePrompt: true       // Устанавливаем в true по твоему желанию
                               // ВАЖНО: Убедись, что API Leonardo действительно ожидает параметр
                               // с именем "enhancePrompt" и что он работает так, как ты ожидаешь
                               // (альтернативой мог быть "promptMagic: true").
  };
  // ----------------------------------------------------

  console.log('Sending payload to Leonardo AI:', JSON.stringify(leonardoPayload, null, 2));

  try {
    const apiResponse = await axios.post(
      `${LEONARDO_API_BASE_URL}/generations`,
      leonardoPayload,
      {
        headers: {
          'accept': 'application/json',
          'authorization': `Bearer ${process.env.LEONARDO_API_KEY}`, // API ключ из переменных окружения
          'content-type': 'application/json'
        }
      }
    );

    // Проверяем, что Leonardo API вернул структуру с generationId
    if (apiResponse.data && apiResponse.data.sdGenerationJob && apiResponse.data.sdGenerationJob.generationId) {
      const generationId = apiResponse.data.sdGenerationJob.generationId;
      console.log(`Leonardo AI job successfully started. Generation ID: ${generationId}`);
      res.status(202).json({ generationId }); // Статус 202 Accepted (операция принята к выполнению)
    } else {
      // Если структура ответа неожиданная, но запрос прошел (статус 2xx)
      console.warn('Unexpected success response structure from Leonardo AI POST /generations:', apiResponse.data);
      // Попытка найти URL, если он вдруг вернулся сразу (менее вероятно для /generations)
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
          res.status(500).json({ 
            error: 'Unexpected response structure from image generation service after job start', 
            details: apiResponse.data 
          });
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
  
  // Логирование начала работы обработчика
  console.log(`[${new Date().toISOString()}] Handler for GET /result/${generationId} CALLED!`);

  if (!generationId) {
    console.error('Missing generationId parameter in /result request');
    return res.status(400).json({ error: 'Missing generationId parameter' });
  }

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

    // Ожидаемая структура ответа от Leonardo API для getGenerationById
    const generationDetails = apiResponse.data && apiResponse.data.generations_by_pk;

    if (generationDetails) {
      const status = generationDetails.status;
      console.log(`Status for Generation ID ${generationId}: ${status}`);

      if (status === 'COMPLETE') {
        if (generationDetails.generated_images && Array.isArray(generationDetails.generated_images) && generationDetails.generated_images.length > 0) {
          const validImageUrls = generationDetails.generated_images
            .map(img => img.url)
            .filter(url => url != null && typeof url === 'string' && url.startsWith('http')); // Более строгая проверка URL

          if (validImageUrls.length > 0) {
            console.log(`Image(s) ready for ${generationId}:`, validImageUrls);
            // Отправляем первый действительный URL, как ожидает твой Flutter-клиент
            res.json({ status: 'COMPLETE', url: validImageUrls[0], allUrls: validImageUrls });
          } else {
            console.error(`Generation COMPLETE for ${generationId} but no valid URLs found:`, generationDetails.generated_images);
            res.status(404).json({ status: 'COMPLETE_NO_VALID_URLS', error: 'Generation complete but no valid image URLs found' });
          }
        } else {
          console.error(`Generation COMPLETE for ${generationId} but 'generated_images' array is missing or empty:`, generationDetails);
          res.status(404).json({ status: 'COMPLETE_NO_IMAGES_ARRAY', error: 'Generation complete but image data is missing' });
        }
      } else if (status === 'PENDING' || status === 'PROCESSING') { // Добавил 'PROCESSING' как возможный статус
        console.log(`Generation ${generationId} is still ${status}.`);
        res.json({ status: status }); // Генерация еще не завершена
      } else if (status === 'FAILED') {
        const failureReason = generationDetails.failureReason || 'Unknown reason';
        console.error(`Leonardo AI generation FAILED for ID ${generationId}. Reason: ${failureReason}`, generationDetails);
        res.status(500).json({ status: 'FAILED', error: 'Image generation failed at Leonardo AI', details: failureReason });
      } else {
        // Неизвестный или неожиданный статус
        console.warn(`Unknown or unexpected status for ${generationId}: ${status}`, generationDetails);
        res.status(500).json({ error: 'Unknown status or unexpected response from Leonardo AI (get result)', status: status, details: generationDetails });
      }
    } else {
      // Если нет `generations_by_pk`, пробуем альтернативные структуры, как обсуждалось
      let foundUrls = [];
      if (apiResponse.data && apiResponse.data.generated_images && Array.isArray(apiResponse.data.generated_images)) {
           foundUrls = apiResponse.data.generated_images.map(img => img.url).filter(url => url != null && typeof url === 'string' && url.startsWith('http'));
      } else if (apiResponse.data && Array.isArray(apiResponse.data) && apiResponse.data.length > 0 && apiResponse.data[0].url) {
           foundUrls = apiResponse.data.map(img => img.url).filter(url => url != null && typeof url === 'string' && url.startsWith('http'));
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
    sendErrorResponse(res, 'Failed to fetch image result from Leonardo AI', err); // Исправлена передача statusCode
  }
});

const PORT = process.env.PORT || 3000; // Render.com автоматически установит переменную PORT
app.listen(PORT, () => {
  console.log(`LEOAPI Server successfully running on port ${PORT}`);
});
