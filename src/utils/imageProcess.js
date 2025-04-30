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
          const base64Data = image.toDataURL(`image/${format}`, quality).split(',')[1];
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

      // 创建一个新的图像元素，用于加载和绘制
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        try {
          // 尝试绘制原始图像
          ctx.drawImage(img, 0, 0, width, height);

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
 * @param {string} method - 预处理方法：'none', 'enhance', 'bw', 'adaptive'
 * @returns {Promise<HTMLCanvasElement>} - 返回处理后的Canvas元素
 */
export function preprocessImage(image, method = 'none') {
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

      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;

      switch (method) {
        case 'enhance':
          // 增强对比度
          for (let i = 0; i < data.length; i += 4) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            const newVal = avg > 127 ? 255 : 0;
            data[i] = data[i + 1] = data[i + 2] = newVal;
          }
          break;

        case 'bw':
          // 黑白转换
          for (let i = 0; i < data.length; i += 4) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            data[i] = data[i + 1] = data[i + 2] = avg;
          }
          break;

        case 'adaptive':
          // 自适应处理（简化版）
          const blockSize = 11;
          const threshold = 15;

          // 复制原始数据
          const originalData = new Uint8ClampedArray(data);

          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              // 计算局部区域的平均值
              let sum = 0;
              let count = 0;

              for (let dy = -blockSize; dy <= blockSize; dy++) {
                for (let dx = -blockSize; dx <= blockSize; dx++) {
                  const nx = x + dx;
                  const ny = y + dy;

                  if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const idx = (ny * width + nx) * 4;
                    sum += (originalData[idx] + originalData[idx + 1] + originalData[idx + 2]) / 3;
                    count++;
                  }
                }
              }

              const avg = sum / count;
              const idx = (y * width + x) * 4;
              const pixelAvg = (originalData[idx] + originalData[idx + 1] + originalData[idx + 2]) / 3;

              // 如果像素值与局部平均值的差异大于阈值，则设为黑色，否则为白色
              const newVal = pixelAvg < avg - threshold ? 0 : 255;
              data[idx] = data[idx + 1] = data[idx + 2] = newVal;
            }
          }
          break;
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas);
    } catch (error) {
      reject(error);
    }
  });
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
    showOriginalText = false
  } = styleOptions;

  // 处理每个文字区域
  textAreas.forEach((area, index) => {
    if (!area || !translatedTexts[index]) return;

    const { x, y, width: areaWidth, height: areaHeight, text: originalText } = area;
    const translatedText = translatedTexts[index];

    // 分析原文字样式
    const style = analyzeTextStyle(image, area);

    // 根据styleLevel调整样式
    const styleRatio = styleLevel / 100;

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
    if (fontSize === 'auto') {
      font += `${style.fontSize}px `;
    } else {
      const fontSizeMap = {
        'smaller': areaHeight * 0.3,
        'small': areaHeight * 0.4,
        'medium': areaHeight * 0.5,
        'large': areaHeight * 0.6,
        'larger': areaHeight * 0.7
      };
      font += `${fontSizeMap[fontSize] || areaHeight * 0.5}px `;
    }

    // 字体系列
    if (fontFamily) {
      font += fontFamily;
    } else {
      font += style.fontFamily;
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
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 绘制翻译文本
    const centerX = x + areaWidth / 2;
    const centerY = y + areaHeight / 2;

    // 自动换行
    const lines = wrapText(ctx, translatedText, areaWidth - 10);
    const lineHeight = style.fontSize * 1.2;

    // 计算起始Y坐标，使文本垂直居中
    const startY = centerY - (lines.length - 1) * lineHeight / 2;

    // 绘制每一行
    lines.forEach((line, i) => {
      ctx.fillText(line, centerX, startY + i * lineHeight);
    });

    // 如果需要显示原文
    if (showOriginalText && originalText) {
      const originalLines = wrapText(ctx, originalText, areaWidth - 10);
      const originalY = y + areaHeight + 5;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(x, originalY - 5, areaWidth, originalLines.length * lineHeight + 10);

      ctx.fillStyle = 'white';
      originalLines.forEach((line, i) => {
        ctx.fillText(line, centerX, originalY + i * lineHeight);
      });
    }
  });

  return canvas;
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

  // 背景色（取四个角的平均值）
  const corners = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: 0, y: height - 1 },
    { x: width - 1, y: height - 1 }
  ];

  let bgR = 0, bgG = 0, bgB = 0;

  corners.forEach(corner => {
    const idx = (corner.y * width + corner.x) * 4;
    bgR += data[idx];
    bgG += data[idx + 1];
    bgB += data[idx + 2];
  });

  bgR = Math.round(bgR / 4);
  bgG = Math.round(bgG / 4);
  bgB = Math.round(bgB / 4);

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

  // 估计字体大小（基于区域高度）
  const fontSize = Math.max(12, Math.round(height * 0.5));

  // 返回样式信息
  return {
    fontSize,
    fontFamily: 'Arial, sans-serif', // 默认字体
    fontColor: { r: fontR, g: fontG, b: fontB },
    backgroundColor: { r: bgR, g: bgG, b: bgB }
  };
}

/**
 * 文本自动换行
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {string} text - 需要换行的文本
 * @param {number} maxWidth - 最大宽度
 * @returns {Array<string>} - 返回换行后的文本数组
 */
function wrapText(ctx, text, maxWidth) {
  const words = text.split('');
  const lines = [];
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const width = ctx.measureText(currentLine + word).width;

    if (width < maxWidth) {
      currentLine += word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}
