# Manga OCR-First Server

这是漫画翻译插件的可选本地加速服务，不是默认必需组件。

它负责：
- 多语言 PaddleOCR 检测与识别
- MangaOCR 二次识别
- 整图 block 上下文文本翻译（默认走文本 LLM）
- 文本翻译 provider 链路（DeepL / Google / 百度）
- 区域级 VLM fallback
- SQLite + 文件缓存

如果你只想先跑插件 MVP，可以不启动这个服务，直接在插件里走 Provider 直连或 Ollama 直连。

## 运行

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

默认启动地址：

```text
http://127.0.0.1:8000
```

## 何时需要这个服务

适合这几类场景：

- 你明确想走“本地加速服务”模式
- 你希望把 OCR、缓存、翻译编排放到本地 Python 服务中
- 你后续要继续扩展 OCR-first、文件缓存、服务端诊断能力

不需要这类能力时，可以只使用插件直连路径。

## 翻译 provider

通过 `MT_PROVIDER_ORDER` 配置优先级，支持：
- `deepl`
- `google`
- `baidu`

示例：

```bash
MT_PROVIDER_ORDER=baidu,deepl,google
```

## 推荐配置

```bash
OCR_LANGUAGES=japan,korean,en
TEXT_LLM_BASE_URL=https://api.siliconflow.cn/v1
TEXT_LLM_API_KEY=your_key
TEXT_LLM_MODEL=Qwen/Qwen2.5-32B-Instruct
```

如果未单独配置 `TEXT_LLM_*`，服务端会回退复用 `VLM_*` 配置做文本上下文翻译。

## 与插件配合

当前插件默认是“插件直连优先”：

- 默认执行路径是 `provider-direct`
- 本地服务是可选加速路径，不会静默接管直连模式
- 只有你在插件设置里显式切换到 `server` 模式时，才会走这个服务

插件侧建议这样配置：

1. 启动本服务
2. 打开插件 `Options`
3. 将运行路径切到“本地加速服务”
4. 把服务地址填成 `http://127.0.0.1:8000`
5. 如果设置了 `SERVER_AUTH_TOKEN`，插件端填写同一个 token

## 说明

- 这个服务当前定位是“可选加速器”，不是插件默认主路径
- 若设置了 `SERVER_AUTH_TOKEN`，插件端也需要填写相同 token
- 如果只是验证插件是否能工作，优先先跑直连路径，再决定是否启用服务端
