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
  // !!! ВАЖНО: ПРОВЕРЬ ЭТИ ПАРАМЕТРЫ ПО АКТУАЛЬНОЙ ОФИЦИАЛЬНОЙ ДОКУМЕНТАЦИИ LEONARDO.AI !!!
  const leonardoPayload = {
    prompt: prompt,
    // modelId: "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3", // ID из примера для Phoenix. Убедись, что он актуален для тебя.
                                                       // Если у тебя есть другой ID для Phoenix, используй его.
                                                       // Если modelId не указать, Leonardo может использовать модель по умолчанию.
    width: parseInt(width, 10),
    height: parseInt(height, 10),
    num_images: 1,            // Генерируем 1 изображение
    alchemy: true,            // Включаем Alchemy (часто нужно для presetStyle и promptMagic)
    promptMagic: true,        // Для "enhance prompt: true".
    // promptMagicVersion: "v3", // УТОЧНИ, нужна ли версия (например, "v2" или "v3") и какая актуальна.
    presetStyle: 'DYNAMIC',   // Для стиля "Dynamic", когда alchemy: true.
    // contrast: 3.5,         // Параметр из примера. Убедись, что он нужен и корректен для Phoenix + Alchemy + Dynamic.
                              // Иногда вместо 'contrast' используется 'contrastRatio' (0.0-1.0).
    // guidance_scale: 7,     // Общий параметр контроля промпта, можно добавить (обычно 5-10).
                              // Проверь, не конфликтует ли он с alchemy/promptMagic.
    // Другие параметры, которые могут быть полезны или необходимы...
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

    // Ожидаем, что Leonardo вернет ID задачи в такой структуре
    if (apiResponse.data && apiResponse.data.sdGenerationJob && apiResponse.data.sdGenerationJob.generationId) {
      const generationId = apiResponse.data.sdGenerationJob.generationId;
      console.log(`Leonardo AI job successfully started. Generation ID: ${generationId}`);
      res.status(202).json({ generationId }); // Статус 202 Accepted, так как это асинхронная операция
    } else {
      // Если структура ответа другая, но запрос успешен (статус 2xx)
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
          res.json({ url: imageUrls[0], status: 'COMPLETE_IMMEDIATELY' }); // Отправляем первый URL
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

    // Ожидаемая структура ответа от Leonardo API для getGenerationById
    const generationDetails = apiResponse.data && apiResponse.data.generations_by_pk;

    if (generationDetails) {
      const status = generationDetails.status;
      console.log(`Status for Generation ID ${generationId}: ${status}`);

      if (status === 'COMPLETE') {
        if (generationDetails.generated_images && Array.isArray(generationDetails.generated_images) && generationDetails.generated_images.length > 0) {
          const validImageUrls = generationDetails.generated_images
            .map(img => img.url)
            .filter(url => url != null && url.startsWith('http')); // Убедимся, что URL действителен

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
      } else if (status === 'PENDING' || status === 'PROCESSING') {
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
      console.error('Unexpected response structure from Leonardo AI GET /generations/:id (missing generations_by_pk):', apiResponse.data);
      res.status(404).json({ error: 'Result not found or unexpected response structure from Leonardo AI (get result)', details: apiResponse.data });
    }

  } catch (err) {
    logLeonardoError(err, `GET /generations/${generationId}`);
    sendErrorResponse(res, 'Failed to fetch image result from Leonardo AI', err);
  }
});

const PORT = process.env.PORT || 3000; // Render.com автоматически установит переменную PORT
app.listen(PORT, () => {
  console.log(`LEOAPI Server successfully running on port ${PORT}`);
});
