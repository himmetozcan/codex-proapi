#!/usr/bin/env python3
"""
测试 Codex Pro API 图像生成接口 POST /v1/images/generations。
需先启动服务：npm start 或 codex-proapi
默认 base_url: http://localhost:1455
"""
import argparse
import base64
import json
import os
import sys
from datetime import datetime
from pathlib import Path

BASE_URL = os.environ.get("CODEX_PROAPI_URL", "http://localhost:1455")
DEFAULT_MODEL = "gpt-image-2"
DEFAULT_PROMPT = "A cute orange cat sitting on a desk next to a laptop, digital art style"
DEFAULT_SIZE = "1024x1024"
DEFAULT_OUTPUT_DIR = Path("test_output/images")
DEFAULT_OUTPUT_FORMAT = "png"


def generate_image(base_url, model, prompt, n=1, size=DEFAULT_SIZE,
                   quality="auto", output_format=DEFAULT_OUTPUT_FORMAT,
                   background="auto", moderation="auto"):
    """POST /v1/images/generations 返回 OpenAI 兼容响应。"""
    import urllib.request
    import urllib.error

    body = {
        "model": model,
        "prompt": prompt,
        "n": n,
        "size": size,
        "quality": quality,
        "output_format": output_format,
        "background": background,
        "moderation": moderation,
    }
    body = {k: v for k, v in body.items() if v is not None}

    url = f"{base_url.rstrip('/')}/v1/images/generations"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer codex-proapi",
        },
        method="POST",
    )

    print(f"→ POST {url}")
    print(f"  model: {model}")
    print(f"  prompt: {prompt[:80]}{'…' if len(prompt) > 80 else ''}")
    print(f"  size: {size}  n: {n}  quality: {quality}")
    print()

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode()
            result = json.loads(raw)
            return result
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")
        print(f"✗ HTTP {e.code}", file=sys.stderr)
        try:
            print(json.dumps(json.loads(body_text), indent=2, ensure_ascii=False), file=sys.stderr)
        except Exception:
            print(body_text[:2000], file=sys.stderr)
        return None
    except Exception as e:
        print(f"✗ 请求失败: {e}", file=sys.stderr)
        return None


def save_images(data_list, output_dir, prefix="image", output_format=DEFAULT_OUTPUT_FORMAT):
    """将 data[] 中的 b64_json 写入文件。"""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    saved = []
    for i, item in enumerate(data_list):
        b64 = item.get("b64_json")
        url = item.get("url")

        if b64:
            raw_bytes = base64.b64decode(b64)
        elif url:
            print(f"  [{i}] 跳过 URL: {url}")
            continue
        else:
            print(f"  [{i}] 无数据")
            continue

        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        ext = output_format if output_format in ("png", "jpg", "jpeg", "webp") else "png"
        filename = f"{prefix}_{ts}_{i}.{ext}"
        filepath = output_dir / filename
        filepath.write_bytes(raw_bytes)
        saved.append(filepath)
        print(f"  ✓ 已保存: {filepath} ({len(raw_bytes):,} bytes)")

    return saved


def quick_check(result):
    """对返回结果做基本断言，失败则退出码非 0。"""
    errors = []

    if not isinstance(result, dict):
        errors.append("返回结果不是 JSON 对象")
    else:
        if "created" not in result:
            errors.append("缺少 created 字段")
        if "data" not in result or not isinstance(result["data"], list):
            errors.append("缺少 data 字段或不是数组")
        elif len(result["data"]) == 0:
            errors.append("data 数组为空")
        else:
            for i, item in enumerate(result["data"]):
                if "url" not in item and "b64_json" not in item:
                    errors.append(f"data[{i}] 缺少 b64_json 或 url 字段")

    if errors:
        print("\n✗ 验证失败:")
        for e in errors:
            print(f"  - {e}")
        return False
    else:
        print(f"\n✓ 验证通过: 返回 {len(result['data'])} 张图像")
        return True


def main():
    parser = argparse.ArgumentParser(
        description="测试 Codex Pro API 图像生成接口",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python scripts/test_image_gen.py
  python scripts/test_image_gen.py --prompt "一只猫" --size 1024x1536 --n 2
  python scripts/test_image_gen.py --model gpt-image-1.5 --save
        """,
    )
    parser.add_argument("--base-url", default=BASE_URL,
                        help=f"服务地址（默认 {BASE_URL}）")
    parser.add_argument("--model", default=DEFAULT_MODEL,
                        help=f"图像模型（默认 {DEFAULT_MODEL}）")
    parser.add_argument("--prompt", default=DEFAULT_PROMPT,
                        help="文本提示词")
    parser.add_argument("--size", default=DEFAULT_SIZE,
                        help=f"图像尺寸（默认 {DEFAULT_SIZE}）")
    parser.add_argument("--n", type=int, default=1,
                        help="生成数量（1-10，默认 1）")
    parser.add_argument("--quality", default="auto",
                        choices=["low", "medium", "high", "auto"],
                        help="质量（默认 auto）")
    parser.add_argument("--output-format", default=DEFAULT_OUTPUT_FORMAT,
                        choices=["png", "jpeg", "webp"],
                        help="输出格式（默认 png）")
    parser.add_argument("--background", default="auto",
                        choices=["transparent", "opaque", "auto"],
                        help="背景透明度（默认 auto）")
    parser.add_argument("--save", action="store_true",
                        help="将 b64_json 保存为文件")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR),
                        help=f"输出目录（默认 {DEFAULT_OUTPUT_DIR}）")
    parser.add_argument("--check-only", action="store_true",
                        help="仅验证响应格式，不保存文件")

    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    if base_url.endswith("/v1"):
        base_url = base_url[:-3]

    print("=" * 60)
    print("Codex Pro API — 图像生成测试")
    print("=" * 60)
    print()

    result = generate_image(
        base_url=base_url,
        model=args.model,
        prompt=args.prompt,
        n=args.n,
        size=args.size,
        quality=args.quality,
        output_format=args.output_format,
        background=args.background,
    )

    if result is None:
        print("\n✗ 请求失败，请确认服务已启动且已添加 Codex 账号。", file=sys.stderr)
        sys.exit(1)

    print(json.dumps(result, indent=2, ensure_ascii=False)[:2000])
    if len(json.dumps(result)) > 2000:
        print(f"\n… 响应过长，已截断（总 {len(json.dumps(result))} 字符）")

    data_list = result.get("data", [])

    if not args.check_only:
        saved = save_images(data_list, args.output_dir,
                            prefix=f"test_{args.model}",
                            output_format=args.output_format)
        if saved:
            print(f"\n✓ 共保存 {len(saved)} 个文件到 {args.output_dir}")

    ok = quick_check(result)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
