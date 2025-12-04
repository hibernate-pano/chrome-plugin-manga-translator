/**
 * 图像处理工具模块
 */

/**
 * 将图像转换为Base64编码
 * @param {HTMLImageElement|HTMLCanvasElement} image - 图像元素或Canvas元素
 * @param {number} maxWidth - 最大宽度，超过则等比例缩小
 * @param {number} maxHeight - 最大高度，超过则等比例缩小
 * @param {string} format - 图像格式，如'jpeg', 'png'
 * @param {number} quality - 图像质量，范围0-1，默认为0.8
 * @returns {Promise<string>} - 返回Base64编码的图像数据
 */
export async function imageToBase64(image, maxWidth = 1024, maxHeight = 1024, format = 'jpeg', quality = 0.8) {
  return new Promise((resolve, reject) => {
    try {
      // 如果输入已经是Canvas，直接使用
      if (image instanceof HTMLCanvasElement) {
        try {
          // 如果Canvas尺寸超过限制，先缩放
          const canvasWidth = image.width;
          const canvasHeight = image.height;
          let scaledCanvas = image;
          
          // 如果Canvas尺寸超过最大值，先缩放
          if (canvasWidth > maxWidth || canvasHeight > maxHeight) {
            const ratio = Math.min(maxWidth / canvasWidth, maxHeight / canvasHeight);
            scaledCanvas = document.createElement('canvas');
            scaledCanvas.width = Math.floor(canvasWidth * ratio);
            scaledCanvas.height = Math.floor(canvasHeight * ratio);
            
            const ctx = scaledCanvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'medium'; // 使用中等质量以平衡速度和质量
            ctx.drawImage(image, 0, 0, scaledCanvas.width, scaledCanvas.height);
          }
          
          const base64Data = scaledCanvas.toDataURL(`image/${format}`, quality).split(',')[1];
          resolve(base64Data);
          return;
        } catch (error) {
          console.error('Canvas转Base64失败:', error);
          // 继续尝试其他方法
        }
      }

      // 创建Canvas
      const canvas = document.createElement('canvas');
      let width = image.naturalWidth || image.width;
      let height = image.naturalHeight || image.height;

      // 等比例缩放
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.floor(width * ratio);
        height = Math.floor(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium'; // 使用中等质量以平衡速度和质量

      // 创建一个新的图像元素，用于加载和绘制
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        try {
          // 尝试绘制原始图像
          ctx.drawImage(img, 0, 0, width, height);

          // 直接使用toDataURL，避免Blob和FileReader的额外开销
          try {
            const dataUrl = canvas.toDataURL(`image/${format}`, quality);
            const base64Data = dataUrl.split(',')[1];
            resolve(base64Data);
          } catch (toDataUrlError) {
            console.warn('toDataURL失败，使用Blob和FileReader替代方法');
            // 使用Blob和FileReader作为替代方法
            canvas.toBlob((blob) => {
              if (!blob) {
                reject(new Error('无法创建Blob'));
                return;
              }

              const reader = new FileReader();
              reader.onloadend = () => {
                const base64Data = reader.result.split(',')[1];
                resolve(base64Data);
              };
              reader.onerror = () => {
                reject(new Error('FileReader读取失败'));
              };
              reader.readAsDataURL(blob);
            }, `image/${format}`, quality);
          }
        } catch (finalError) {
          reject(finalError);
        }
      };

      // 如果是原始图像元素，设置src以触发加载
      if (image instanceof HTMLImageElement) {
        // 尝试使用原始src或转换为blob URL
        if (image.src.startsWith('data:') || image.src.startsWith('blob:')) {
          img.src = image.src;
        } else {
          // 使用Promise来处理异步的存储访问
          new Promise((resolveSettings) => {
            chrome.storage.sync.get(['advancedSettings'], (result) => {
              resolveSettings(result.advancedSettings || {});
            });
          })
          .then(advancedSettings => {
            const useCorsProxy = advancedSettings.useCorsProxy || false;
            const corsProxyType = advancedSettings.corsProxyType || 'corsproxy';
            const customCorsProxy = advancedSettings.customCorsProxy || '';

            // 定义可用的代理服务列表
            const proxyServices = [
              {
                name: 'corsproxy',
                url: `https://corsproxy.io/?${encodeURIComponent(image.src)}`,
                isDefault: true,
                weight: 10 // 权重，用于智能排序
              },
              {
                name: 'allorigins',
                url: `https://api.allorigins.win/raw?url=${encodeURIComponent(image.src)}`,
                weight: 8
              },
              {
                name: 'cors-anywhere',
                url: `https://cors-anywhere.herokuapp.com/${image.src}`,
                weight: 6
              },
              {
                name: 'corsanywhere',
                url: `https://corsanywhere.herokuapp.com/${image.src}`,
                weight: 7
              },
              {
                name: 'thingproxy',
                url: `https://thingproxy.freeboard.io/fetch/${image.src}`,
                weight: 5
              }
            ];
            
            // 如果有自定义代理，添加到列表
            if (corsProxyType === 'custom' && customCorsProxy) {
              proxyServices.unshift({
                name: 'custom',
                url: customCorsProxy.replace('{url}', encodeURIComponent(image.src)),
                isDefault: true,
                weight: 15
              });
            }
            
            // 检查是否有代理成功历史记录
            const checkProxyHistory = async () => {
              return new Promise(resolve => {
                chrome.storage.local.get(['proxyHistory'], result => {
                  const history = result.proxyHistory || {};
                  resolve(history);
                });
              });
            };
            
            // 更新代理历史记录
            const updateProxyHistory = async (proxyName, success, responseTime) => {
              const history = await checkProxyHistory();
              
              if (!history[proxyName]) {
                history[proxyName] = {
                  successCount: 0,
                  failCount: 0,
                  totalTime: 0,
                  lastUsed: Date.now()
                };
              }
              
              if (success) {
                history[proxyName].successCount++;
                history[proxyName].totalTime += responseTime;
              } else {
                history[proxyName].failCount++;
              }
              
              history[proxyName].lastUsed = Date.now();
              
              chrome.storage.local.set({ proxyHistory: history });
            };
            
            // 智能排序代理服务
            const sortProxyServices = async (services) => {
              const history = await checkProxyHistory();
              
              return services.sort((a, b) => {
                const aHistory = history[a.name] || { successCount: 0, failCount: 0, totalTime: 0 };
                const bHistory = history[b.name] || { successCount: 0, failCount: 0, totalTime: 0 };
                
                // 计算成功率
                const aTotal = aHistory.successCount + aHistory.failCount;
                const bTotal = bHistory.successCount + bHistory.failCount;
                
                const aSuccessRate = aTotal > 0 ? aHistory.successCount / aTotal : 0;
                const bSuccessRate = bTotal > 0 ? bHistory.successCount / bTotal : 0;
                
                // 计算平均响应时间
                const aAvgTime = aHistory.successCount > 0 ? aHistory.totalTime / aHistory.successCount : 1000;
                const bAvgTime = bHistory.successCount > 0 ? bHistory.totalTime / bHistory.successCount : 1000;
                
                // 计算综合得分 (成功率 * 权重 - 响应时间因子)
                const aScore = (aSuccessRate * a.weight) - (aAvgTime / 1000);
                const bScore = (bSuccessRate * b.weight) - (bAvgTime / 1000);
                
                // 如果有默认代理，优先考虑
                if (a.isDefault && !b.isDefault) return -1;
                if (!a.isDefault && b.isDefault) return 1;
                
                // 按得分排序
                return bScore - aScore;
              });
            };
            
            // 检查图像URL是否已经缓存
            const checkImageCache = async (imageUrl) => {
              return new Promise(resolve => {
                const cacheKey = `img_cache_${btoa(imageUrl).substring(0, 100)}`;
                chrome.storage.local.get([cacheKey], result => {
                  if (result[cacheKey] && Date.now() - result[cacheKey].timestamp < 86400000) { // 缓存24小时
                    resolve(result[cacheKey].dataUrl);
                  } else {
                    resolve(null);
                  }
                });
              });
            };
            
            // 缓存图像数据
            const cacheImage = (imageUrl, dataUrl) => {
              const cacheKey = `img_cache_${btoa(imageUrl).substring(0, 100)}`;
              chrome.storage.local.set({
                [cacheKey]: {
                  dataUrl,
                  timestamp: Date.now()
                }
              });
            };
            
            // 主函数：智能加载图像
            const smartLoadImage = async () => {
              if (!useCorsProxy) {
                // 如果未启用代理，直接加载原始图像
                img.src = image.src;
                return;
              }
              
              console.log('使用CORS代理加载图像:', image.src);
              
              // 检查缓存
              const cachedImage = await checkImageCache(image.src);
              if (cachedImage) {
                console.log('使用缓存的图像数据');
                img.src = cachedImage;
                return;
              }
              
              // 智能排序代理服务
              const sortedProxies = await sortProxyServices(proxyServices);
              console.log('智能排序后的代理服务:', sortedProxies.map(p => p.name));
              
              // 尝试加载图像的函数
              const tryLoadWithProxy = (index = 0) => {
                if (index >= sortedProxies.length) {
                  // 所有代理都失败，尝试直接加载
                  console.warn('所有代理服务都失败，尝试直接加载');
                  img.src = image.src;
                  return;
                }
                
                const proxy = sortedProxies[index];
                console.log(`尝试使用代理服务 ${proxy.name}`);
                
                const startTime = performance.now();
                
                // 设置加载超时
                const timeoutId = setTimeout(() => {
                  if (!img.complete) {
                    console.warn(`代理 ${proxy.name} 加载超时，尝试下一个代理`);
                    updateProxyHistory(proxy.name, false, 0);
                    tryLoadWithProxy(index + 1);
                  }
                }, 8000); // 8秒超时
                
                // 设置加载事件处理
                const handleLoad = () => {
                  const endTime = performance.now();
                  const responseTime = endTime - startTime;
                  
                  clearTimeout(timeoutId);
                  img.removeEventListener('load', handleLoad);
                  img.removeEventListener('error', handleError);
                  
                  console.log(`代理 ${proxy.name} 加载成功，响应时间: ${responseTime.toFixed(0)}ms`);
                  
                  // 更新代理历史
                  updateProxyHistory(proxy.name, true, responseTime);
                  
                  // 缓存图像数据
                  try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                    cacheImage(image.src, dataUrl);
                  } catch (e) {
                    console.warn('缓存图像失败:', e);
                  }
                };
                
                const handleError = () => {
                  clearTimeout(timeoutId);
                  img.removeEventListener('load', handleLoad);
                  img.removeEventListener('error', handleError);
                  
                  console.warn(`代理 ${proxy.name} 加载失败，尝试下一个代理`);
                  updateProxyHistory(proxy.name, false, 0);
                  tryLoadWithProxy(index + 1);
                };
                
                img.addEventListener('load', handleLoad);
                img.addEventListener('error', handleError);
                
                // 设置代理URL
                img.src = proxy.url;
              };
              
              // 开始尝试加载
              tryLoadWithProxy();
            };
            
            // 执行智能加载
            smartLoadImage();
          })
          .catch(error => {
            console.error('获取CORS代理设置失败:', error);
            // 出错时直接使用原始URL
            img.src = image.src;
          });
        }
      } else {
        // 如果不是图像元素，直接拒绝
        reject(new Error('输入必须是HTMLImageElement或HTMLCanvasElement'));
      }
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 预处理图像以提高文字识别率
 * @param {HTMLImageElement} image - 图像元素
 * @param {string} method - 预处理方法：'none', 'enhance', 'bw', 'adaptive', 'denoise', 'sharpen', 'equalize', 'resize'
 * @param {Object} options - 预处理选项
 * @returns {Promise<HTMLCanvasElement>} - 返回处理后的Canvas元素
 */
export function preprocessImage(image, method = 'none', options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement('canvas');
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, width, height);

      if (method === 'none') {
        resolve(canvas);
        return;
      }

      let processedCanvas = canvas;

      // 支持多种预处理方法组合
      const methods = Array.isArray(method) ? method : [method];
      
      // 依次应用每个预处理方法
      for (const m of methods) {
        processedCanvas = applyPreprocessingMethod(processedCanvas, m, options);
      }

      resolve(processedCanvas);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 应用单个预处理方法
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {string} method - 预处理方法
 * @param {Object} options - 预处理选项
 * @returns {HTMLCanvasElement} - 返回处理后的Canvas元素
 */
function applyPreprocessingMethod(canvas, method, options) {
  const width = canvas.width;
  const height = canvas.height;
  
  // 对于非常大的图像，先缩小再处理，最后恢复大小
  const isLargeImage = width > 2048 || height > 2048;
  let scaledCanvas = canvas;
  let scaleRatio = 1;
  
  if (isLargeImage) {
    // 缩小图像以提高处理速度
    scaleRatio = Math.min(2048 / width, 2048 / height);
    scaledCanvas = resizeImage(canvas, Math.floor(width * scaleRatio), Math.floor(height * scaleRatio));
  }
  
  const ctx = scaledCanvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, scaledCanvas.width, scaledCanvas.height);
  const data = imageData.data;

  let processedCanvas;
  switch (method) {
    case 'enhance':
      // 增强对比度
      processedCanvas = enhanceContrast(scaledCanvas, imageData, data);
      break;
      
    case 'bw':
      // 黑白转换
      processedCanvas = grayscale(scaledCanvas, imageData, data);
      break;
      
    case 'adaptive':
      // 自适应二值化处理
      processedCanvas = adaptiveThresholding(scaledCanvas, imageData, data, options);
      break;
      
    case 'denoise':
      // 高斯模糊降噪 - 使用较小的核大小以提高速度
      const denoiseOptions = { ...options, kernelSize: Math.min(options.kernelSize || 3, 5) };
      processedCanvas = gaussianBlur(scaledCanvas, imageData, data, denoiseOptions);
      break;
      
    case 'sharpen':
      // 锐化增强 - 使用较小的核大小以提高速度
      const sharpenOptions = { ...options, strength: options.strength || 0.5 };
      processedCanvas = sharpenImage(scaledCanvas, imageData, data, sharpenOptions);
      break;
      
    case 'equalize':
      // 直方图均衡化
      processedCanvas = histogramEqualization(scaledCanvas, imageData, data);
      break;
      
    case 'resize':
      // 缩放处理
      processedCanvas = resizeImage(canvas, options.width || width, options.height || height);
      break;
      
    case 'rotate':
      // 旋转校正
      processedCanvas = rotateImage(canvas, options.angle || 0);
      break;
      
    case 'invert':
      // 图像反转
      processedCanvas = invertImage(scaledCanvas, imageData, data);
      break;
      
    default:
      processedCanvas = scaledCanvas;
  }
  
  // 如果原始图像被缩小处理，现在恢复原始大小
  if (isLargeImage && processedCanvas === scaledCanvas) {
    processedCanvas = resizeImage(processedCanvas, width, height);
  }
  
  return processedCanvas;
}

/**
 * 增强对比度
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {ImageData} imageData - 图像数据
 * @param {Uint8ClampedArray} data - 像素数据
 * @returns {HTMLCanvasElement} - 返回处理后的Canvas元素
 */
function enhanceContrast(canvas, imageData, data) {
  const ctx = canvas.getContext('2d');
  const contrast = 1.5; // 对比度因子
  const brightness = 0; // 亮度偏移
  
  for (let i = 0; i < data.length; i += 4) {
    // 计算灰度值
    const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
    // 应用对比度和亮度调整
    const newVal = Math.max(0, Math.min(255, ((gray - 128) * contrast + 128 + brightness)));
    // 设置所有通道为相同值
    data[i] = data[i + 1] = data[i + 2] = newVal;
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * 黑白转换
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {ImageData} imageData - 图像数据
 * @param {Uint8ClampedArray} data - 像素数据
 * @returns {HTMLCanvasElement} - 返回处理后的Canvas元素
 */
function grayscale(canvas, imageData, data) {
  const ctx = canvas.getContext('2d');
  
  for (let i = 0; i < data.length; i += 4) {
    // 计算灰度值
    const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
    // 设置所有通道为相同值
    data[i] = data[i + 1] = data[i + 2] = gray;
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * 自适应二值化处理 - 使用积分图像优化，复杂度从O(n^2)降至O(n)
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {ImageData} imageData - 图像数据
 * @param {Uint8ClampedArray} data - 像素数据
 * @param {Object} options - 选项
 * @returns {HTMLCanvasElement} - 返回处理后的Canvas元素
 */
function adaptiveThresholding(canvas, imageData, data, options) {
  const ctx = canvas.getContext('2d');
  const blockSize = Math.max(3, Math.min(options.blockSize || 11, 21)); // 限制块大小范围
  const threshold = options.threshold || 15;
  const width = canvas.width;
  const height = canvas.height;
  
  // 确保块大小是奇数
  const oddBlockSize = blockSize % 2 === 0 ? blockSize + 1 : blockSize;
  const halfBlockSize = Math.floor(oddBlockSize / 2);
  
  // 复制原始数据
  const originalData = new Uint8ClampedArray(data);
  
  // 计算灰度图像
  const grayData = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i += 4) {
    const idx = Math.floor(i / 4);
    grayData[idx] = Math.round((originalData[i] + originalData[i + 1] + originalData[i + 2]) / 3);
  }
  
  // 计算积分图像 - 优化的关键
  const integralImage = new Uint32Array(width * height);
  
  // 第一次遍历：计算行积分
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      rowSum += grayData[idx];
      
      if (y === 0) {
        integralImage[idx] = rowSum;
      } else {
        integralImage[idx] = rowSum + integralImage[(y - 1) * width + x];
      }
    }
  }
  
  // 第二次遍历：应用自适应阈值
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 计算块的边界
      const x1 = Math.max(0, x - halfBlockSize);
      const y1 = Math.max(0, y - halfBlockSize);
      const x2 = Math.min(width - 1, x + halfBlockSize);
      const y2 = Math.min(height - 1, y + halfBlockSize);
      
      // 计算块内像素数量
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      
      // 使用积分图像快速计算块内总和
      let sum = integralImage[y2 * width + x2];
      if (x1 > 0) sum -= integralImage[y2 * width + (x1 - 1)];
      if (y1 > 0) sum -= integralImage[(y1 - 1) * width + x2];
      if (x1 > 0 && y1 > 0) sum += integralImage[(y1 - 1) * width + (x1 - 1)];
      
      // 计算平均值
      const avg = sum / count;
      
      // 应用阈值
      const idx = y * width + x;
      const pixelAvg = grayData[idx];
      const newVal = pixelAvg < avg - threshold ? 0 : 255;
      
      // 更新像素数据
      const pixelIdx = idx * 4;
      data[pixelIdx] = data[pixelIdx + 1] = data[pixelIdx + 2] = newVal;
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * 高斯模糊降噪 - 使用分离卷积优化，将二维卷积分解为两个一维卷积
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {ImageData} imageData - 图像数据
 * @param {Uint8ClampedArray} data - 像素数据
 * @param {Object} options - 选项
 * @returns {HTMLCanvasElement} - 返回处理后的Canvas元素
 */
function gaussianBlur(canvas, imageData, data, options) {
  const ctx = canvas.getContext('2d');
  const kernelSize = Math.max(3, Math.min(options.kernelSize || 3, 11)); // 限制核大小范围
  const sigma = options.sigma || 1.0;
  const width = canvas.width;
  const height = canvas.height;
  
  // 确保核大小是奇数
  const oddKernelSize = kernelSize % 2 === 0 ? kernelSize + 1 : kernelSize;
  
  // 创建一维高斯核
  const kernel = createGaussianKernel1D(oddKernelSize, sigma);
  
  // 复制原始数据
  const originalData = new Uint8ClampedArray(data);
  const tempData = new Uint8ClampedArray(data);
  
  // 第一步：应用水平卷积
  applyConvolution1D(tempData, originalData, width, height, kernel, true);
  
  // 第二步：应用垂直卷积
  applyConvolution1D(data, tempData, width, height, kernel, false);
  
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * 创建一维高斯核
 * @param {number} size - 核大小
 * @param {number} sigma - 标准差
 * @returns {Array<number>} - 返回一维高斯核
 */
function createGaussianKernel1D(size, sigma) {
  const kernel = new Float32Array(size);
  const center = Math.floor(size / 2);
  let sum = 0;
  
  for (let i = 0; i < size; i++) {
    const dx = i - center;
    const value = Math.exp(-(dx * dx) / (2 * sigma * sigma));
    kernel[i] = value;
    sum += value;
  }
  
  // 归一化核
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }
  
  return kernel;
}

/**
 * 应用一维卷积
 * @param {Uint8ClampedArray} data - 输出像素数据
 * @param {Uint8ClampedArray} originalData - 输入像素数据
 * @param {number} width - 图像宽度
 * @param {number} height - 图像高度
 * @param {Float32Array} kernel - 一维卷积核
 * @param {boolean} isHorizontal - 是否为水平卷积
 */
function applyConvolution1D(data, originalData, width, height, kernel, isHorizontal) {
  const kernelSize = kernel.length;
  const center = Math.floor(kernelSize / 2);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      
      for (let k = 0; k < kernelSize; k++) {
        const offset = k - center;
        const nx = isHorizontal ? x + offset : x;
        const ny = isHorizontal ? y : y + offset;
        
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const idx = (ny * width + nx) * 4;
          const weight = kernel[k];
          r += originalData[idx] * weight;
          g += originalData[idx + 1] * weight;
          b += originalData[idx + 2] * weight;
        }
      }
      
      const idx = (y * width + x) * 4;
      data[idx] = Math.max(0, Math.min(255, r));
      data[idx + 1] = Math.max(0, Math.min(255, g));
      data[idx + 2] = Math.max(0, Math.min(255, b));
    }
  }
}

/**
 * 锐化增强 - 使用优化的卷积实现
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {ImageData} imageData - 图像数据
 * @param {Uint8ClampedArray} data - 像素数据
 * @param {Object} options - 选项
 * @returns {HTMLCanvasElement} - 返回处理后的Canvas元素
 */
function sharpenImage(canvas, imageData, data, options) {
  const ctx = canvas.getContext('2d');
  const strength = Math.max(0.1, Math.min(options.strength || 0.5, 2.0)); // 限制强度范围
  const width = canvas.width;
  const height = canvas.height;
  
  // 锐化核 - 固定3x3大小以提高性能
  const kernel = [
    [0, -strength, 0],
    [-strength, 1 + 4 * strength, -strength],
    [0, -strength, 0]
  ];
  
  // 复制原始数据
  const originalData = new Uint8ClampedArray(data);
  
  // 直接应用3x3卷积，避免通用卷积函数的额外开销
  const center = 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      
      for (let ky = 0; ky < 3; ky++) {
        for (let kx = 0; kx < 3; kx++) {
          const nx = x + kx - center;
          const ny = y + ky - center;
          
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const idx = (ny * width + nx) * 4;
            const weight = kernel[ky][kx];
            r += originalData[idx] * weight;
            g += originalData[idx + 1] * weight;
            b += originalData[idx + 2] * weight;
          }
        }
      }
      
      const idx = (y * width + x) * 4;
      data[idx] = Math.max(0, Math.min(255, r));
      data[idx + 1] = Math.max(0, Math.min(255, g));
      data[idx + 2] = Math.max(0, Math.min(255, b));
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * 直方图均衡化
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {ImageData} imageData - 图像数据
 * @param {Uint8ClampedArray} data - 像素数据
 * @returns {HTMLCanvasElement} - 返回处理后的Canvas元素
 */
function histogramEqualization(canvas, imageData, data) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  
  // 计算灰度直方图
  const histogram = new Array(256).fill(0);
  
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3);
    histogram[gray]++;
  }
  
  // 计算累积分布函数
  const cdf = new Array(256).fill(0);
  cdf[0] = histogram[0];
  
  for (let i = 1; i < 256; i++) {
    cdf[i] = cdf[i - 1] + histogram[i];
  }
  
  // 归一化CDF
  const cdfMin = cdf.find(v => v > 0);
  const totalPixels = width * height;
  
  // 应用直方图均衡化
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3);
    const newGray = Math.round(((cdf[gray] - cdfMin) / (totalPixels - cdfMin)) * 255);
    data[i] = data[i + 1] = data[i + 2] = newGray;
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * 缩放图像
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {number} newWidth - 新宽度
 * @param {number} newHeight - 新高度
 * @returns {HTMLCanvasElement} - 返回处理后的Canvas元素
 */
function resizeImage(canvas, newWidth, newHeight) {
  const newCanvas = document.createElement('canvas');
  newCanvas.width = newWidth;
  newCanvas.height = newHeight;
  
  const ctx = newCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, newWidth, newHeight);
  
  return newCanvas;
}

/**
 * 旋转图像
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {number} angle - 旋转角度（度）
 * @returns {HTMLCanvasElement} - 返回处理后的Canvas元素
 */
function rotateImage(canvas, angle) {
  const radians = (angle * Math.PI) / 180;
  const newCanvas = document.createElement('canvas');
  
  // 计算旋转后的画布大小
  const width = canvas.width;
  const height = canvas.height;
  const newWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
  const newHeight = Math.abs(height * Math.cos(radians)) + Math.abs(width * Math.sin(radians));
  
  newCanvas.width = newWidth;
  newCanvas.height = newHeight;
  
  const ctx = newCanvas.getContext('2d');
  
  // 平移到画布中心
  ctx.translate(newWidth / 2, newHeight / 2);
  ctx.rotate(radians);
  
  // 绘制旋转后的图像
  ctx.drawImage(canvas, -width / 2, -height / 2);
  
  return newCanvas;
}

/**
 * 反转图像
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {ImageData} imageData - 图像数据
 * @param {Uint8ClampedArray} data - 像素数据
 * @returns {HTMLCanvasElement} - 返回处理后的Canvas元素
 */
function invertImage(canvas, imageData, data) {
  const ctx = canvas.getContext('2d');
  
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];       // 红色通道
    data[i + 1] = 255 - data[i + 1]; // 绿色通道
    data[i + 2] = 255 - data[i + 2]; // 蓝色通道
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * 在图像上渲染翻译后的文字
 * @param {HTMLImageElement} image - 原始图像元素
 * @param {Array} textAreas - 文字区域信息数组
 * @param {Array<string>} translatedTexts - 翻译后的文本数组
 * @param {Object} styleOptions - 样式选项
 * @returns {HTMLCanvasElement} - 返回处理后的Canvas元素
 */
export function renderTranslatedImage(image, textAreas, translatedTexts, styleOptions = {}) {
  const canvas = document.createElement('canvas');
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');

  // 绘制原图像
  ctx.drawImage(image, 0, 0, width, height);

  // 样式选项
  const {
    styleLevel = 50,
    fontFamily = '',
    fontSize = 'auto',
    fontColor = 'auto',
    backgroundColor = 'auto',
    showOriginalText = false,
    lineSpacing = 'auto',
    textAlignment = 'auto',
    textDirection = 'auto' // 'horizontal' or 'vertical'
  } = styleOptions;

  // 处理每个文字区域
  textAreas.forEach((area, index) => {
    if (!area || !translatedTexts[index]) return;

    const { x, y, width: areaWidth, height: areaHeight, text: originalText, metadata } = area;
    const translatedText = translatedTexts[index];

    // 分析原文字样式
    const style = analyzeTextStyle(image, area);

    // 根据styleLevel调整样式
    const styleRatio = styleLevel / 100;

    // 确定文本方向
    const isVertical = textDirection === 'vertical' || 
                      (textDirection === 'auto' && metadata?.readingDirection === 'rtl') ||
                      areaHeight > areaWidth * 1.5;

    // 背景透明度
    const bgAlpha = Math.max(0.1, 0.7 - styleRatio * 0.6);

    // 绘制背景
    if (backgroundColor !== 'transparent') {
      const bgColor = backgroundColor === 'auto' ? style.backgroundColor : backgroundColor;
      ctx.fillStyle = `rgba(${bgColor.r}, ${bgColor.g}, ${bgColor.b}, ${bgAlpha})`;
      ctx.fillRect(x, y, areaWidth, areaHeight);
    }

    // 设置字体
    let font = '';

    // 字体大小
    let calculatedFontSize;
    if (fontSize === 'auto') {
      calculatedFontSize = isVertical ? areaWidth * 0.8 : areaHeight * 0.6;
    } else {
      const fontSizeMap = {
        'smaller': isVertical ? areaWidth * 0.4 : areaHeight * 0.3,
        'small': isVertical ? areaWidth * 0.5 : areaHeight * 0.4,
        'medium': isVertical ? areaWidth * 0.6 : areaHeight * 0.5,
        'large': isVertical ? areaWidth * 0.7 : areaHeight * 0.6,
        'larger': isVertical ? areaWidth * 0.8 : areaHeight * 0.7
      };
      calculatedFontSize = fontSizeMap[fontSize] || (isVertical ? areaWidth * 0.6 : areaHeight * 0.5);
    }
    
    // 字体粗细
    font += 'bold ';
    // 字体大小和系列
    font += `${calculatedFontSize}px `;
    if (fontFamily) {
      font += fontFamily;
    } else {
      font += isVertical ? '"Noto Sans CJK JP", "Microsoft YaHei", serif' : '"Noto Sans CJK JP", "Microsoft YaHei", sans-serif';
    }

    ctx.font = font;

    // 字体颜色
    if (fontColor === 'auto') {
      ctx.fillStyle = `rgb(${style.fontColor.r}, ${style.fontColor.g}, ${style.fontColor.b})`;
    } else if (fontColor.startsWith('#')) {
      ctx.fillStyle = fontColor;
    } else {
      ctx.fillStyle = fontColor;
    }

    // 文本对齐
    const alignment = textAlignment === 'auto' ? 'center' : textAlignment;
    ctx.textAlign = alignment;
    ctx.textBaseline = 'middle';

    // 计算行间距
    const spacing = lineSpacing === 'auto' ? calculatedFontSize * 1.2 : calculatedFontSize * (lineSpacing / 100);

    // 绘制翻译文本
    if (isVertical) {
      drawVerticalText(ctx, translatedText, x, y, areaWidth, areaHeight, calculatedFontSize, spacing);
    } else {
      drawHorizontalText(ctx, translatedText, x, y, areaWidth, areaHeight, calculatedFontSize, spacing, alignment);
    }

    // 如果需要显示原文
    if (showOriginalText && originalText) {
      const originalY = y + areaHeight + 5;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(x, originalY - 5, areaWidth, isVertical ? areaHeight : calculatedFontSize + 10);
      ctx.fillStyle = 'white';
      
      if (isVertical) {
        drawVerticalText(ctx, originalText, x, originalY, areaWidth, calculatedFontSize + 10, calculatedFontSize * 0.8, calculatedFontSize * 1.0);
      } else {
        ctx.fillText(originalText, x + areaWidth / 2, originalY + calculatedFontSize / 2);
      }
    }
  });

  return canvas;
}

/**
 * 绘制水平文本
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {string} text - 文本内容
 * @param {number} x - 区域X坐标
 * @param {number} y - 区域Y坐标
 * @param {number} width - 区域宽度
 * @param {number} height - 区域高度
 * @param {number} fontSize - 字体大小
 * @param {number} lineSpacing - 行间距
 * @param {string} alignment - 文本对齐方式
 */
function drawHorizontalText(ctx, text, x, y, width, height, fontSize, lineSpacing, alignment) {
  // 自动换行
  const lines = wrapText(ctx, text, width - 20);
  
  // 计算起始位置，确保文本垂直居中
  const totalHeight = lines.length * lineSpacing;
  const startY = y + (height - totalHeight) / 2 + fontSize / 2;
  
  // 绘制每一行
  lines.forEach((line, i) => {
    let lineX = x + width / 2;
    if (alignment === 'left') {
      lineX = x + 10;
    } else if (alignment === 'right') {
      lineX = x + width - 10;
    }
    ctx.fillText(line, lineX, startY + i * lineSpacing);
  });
}

/**
 * 绘制垂直文本
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {string} text - 文本内容
 * @param {number} x - 区域X坐标
 * @param {number} y - 区域Y坐标
 * @param {number} width - 区域宽度
 * @param {number} height - 区域高度
 * @param {number} fontSize - 字体大小
 * @param {number} lineSpacing - 行间距
 */
function drawVerticalText(ctx, text, x, y, width, height, fontSize, lineSpacing) {
  // 自动换行（垂直方向）
  const lines = wrapVerticalText(text, Math.floor(height / lineSpacing));
  
  // 计算起始位置，确保文本水平居中
  const totalWidth = lines.length * lineSpacing;
  const startX = x + (width - totalWidth) / 2 + fontSize / 2;
  
  // 保存当前上下文状态
  ctx.save();
  
  // 绘制每一行（垂直排列）
  lines.forEach((line, i) => {
    // 对于垂直文本，每个字符单独旋转绘制
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      const charX = startX + i * lineSpacing;
      const charY = y + 10 + j * fontSize;
      
      // 保存当前上下文状态
      ctx.save();
      
      // 旋转字符
      ctx.translate(charX, charY);
      ctx.rotate(Math.PI / 2);
      
      // 绘制字符
      ctx.fillText(char, 0, 0);
      
      // 恢复上下文状态
      ctx.restore();
    }
  });
  
  // 恢复上下文状态
  ctx.restore();
}

/**
 * 分析原文字样式
 * @param {HTMLImageElement} image - 图像元素
 * @param {Object} textArea - 文字区域信息
 * @returns {Object} - 返回分析的样式信息
 */
export function analyzeTextStyle(image, textArea) {
  const { x, y, width, height } = textArea;

  // 创建临时Canvas来分析样式
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, x, y, width, height, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // 分析颜色
  let rSum = 0, gSum = 0, bSum = 0;
  let pixelCount = 0;
  let darkPixels = 0;
  let lightPixels = 0;

  // 背景色（取四个角和中心的平均值）
  const samplePoints = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: 0, y: height - 1 },
    { x: width - 1, y: height - 1 },
    { x: Math.floor(width / 2), y: Math.floor(height / 2) }
  ];

  let bgR = 0, bgG = 0, bgB = 0;

  samplePoints.forEach(point => {
    const idx = (point.y * width + point.x) * 4;
    bgR += data[idx];
    bgG += data[idx + 1];
    bgB += data[idx + 2];
  });

  bgR = Math.round(bgR / samplePoints.length);
  bgG = Math.round(bgG / samplePoints.length);
  bgB = Math.round(bgB / samplePoints.length);

  // 前景色（非背景色的平均值）
  const threshold = 30; // 颜色差异阈值

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // 如果与背景色差异大，认为是前景色
    const diff = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);

    if (diff > threshold) {
      rSum += r;
      gSum += g;
      bSum += b;
      pixelCount++;
      
      // 统计明暗像素比例
      const brightness = (r + g + b) / 3;
      if (brightness < 128) {
        darkPixels++;
      } else {
        lightPixels++;
      }
    }
  }

  // 如果没有明显的前景色，使用与背景色相反的颜色
  let fontR, fontG, fontB;

  if (pixelCount > 0) {
    fontR = Math.round(rSum / pixelCount);
    fontG = Math.round(gSum / pixelCount);
    fontB = Math.round(bSum / pixelCount);
  } else {
    fontR = 255 - bgR;
    fontG = 255 - bgG;
    fontB = 255 - bgB;
  }

  // 估计字体大小（基于区域高度和宽度）
  const fontSize = Math.max(12, Math.round(Math.min(width, height) * 0.5));

  // 分析字体粗细
  const isBold = darkPixels > lightPixels * 1.2;

  // 返回样式信息
  return {
    fontSize,
    fontFamily: 'Arial, sans-serif', // 默认字体
    fontWeight: isBold ? 'bold' : 'normal',
    fontColor: { r: fontR, g: fontG, b: fontB },
    backgroundColor: { r: bgR, g: bgG, b: bgB }
  };
}

/**
 * 文本自动换行（水平）
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {string} text - 需要换行的文本
 * @param {number} maxWidth - 最大宽度
 * @returns {Array<string>} - 返回换行后的文本数组
 */
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  // 处理单个单词超过最大宽度的情况
  const handleLongWord = (word) => {
    if (ctx.measureText(word).width <= maxWidth) {
      return [word];
    }
    
    // 逐个字符分割长单词
    const chars = word.split('');
    const wrappedChars = [];
    let currentCharLine = '';
    
    chars.forEach(char => {
      if (ctx.measureText(currentCharLine + char).width <= maxWidth) {
        currentCharLine += char;
      } else {
        wrappedChars.push(currentCharLine);
        currentCharLine = char;
      }
    });
    
    if (currentCharLine) {
      wrappedChars.push(currentCharLine);
    }
    
    return wrappedChars;
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const wordLines = handleLongWord(word);
    
    wordLines.forEach((wordLine, lineIndex) => {
      if (lineIndex > 0) {
        // 如果是长单词的换行部分，直接添加为新行
        lines.push(currentLine.trim());
        currentLine = `${wordLine  } `;
      } else {
        const testLine = `${currentLine + word  } `;
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        
        if (testWidth > maxWidth && currentLine !== '') {
          lines.push(currentLine.trim());
          currentLine = `${word  } `;
        } else {
          currentLine = testLine;
        }
      }
    });
  }

  if (currentLine) {
    lines.push(currentLine.trim());
  }

  return lines;
}

/**
 * 文本自动换行（垂直）
 * @param {string} text - 需要换行的文本
 * @param {number} maxLines - 最大行数
 * @returns {Array<string>} - 返回换行后的文本数组
 */
function wrapVerticalText(text, maxLines) {
  const lines = [];
  let currentLine = '';
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    // 如果当前行字符数达到最大行数，换行
    if (currentLine.length >= maxLines) {
      lines.push(currentLine);
      currentLine = char;
    } else {
      currentLine += char;
    }
  }
  
  if (currentLine) {
    lines.push(currentLine);
  }
  
  return lines;
}
