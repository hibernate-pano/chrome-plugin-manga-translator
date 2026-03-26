# Manga OCR-First Server

自托管服务端，负责：
- 多语言 PaddleOCR 检测与识别
- MangaOCR 二次识别
- 整图 block 上下文文本翻译（默认走文本 LLM）
- 文本翻译 provider 链路（DeepL / Google / 百度）
- 区域级 VLM fallback
- SQLite + 文件缓存

## 运行

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

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

## 说明

- 插件启用“服务端模式”后，请将地址填为 `http://127.0.0.1:8000`
- 若设置了 `SERVER_AUTH_TOKEN`，插件端也需要填写相同 token
- 当前首版默认保留插件端 provider-direct 兼容路径，服务端不可用时可切回
