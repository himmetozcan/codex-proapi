from openai import OpenAI
import base64, requests

client = OpenAI(base_url="http://localhost:1455/v1", api_key="sk-")

# 用一张测试图片 URL
r = client.chat.completions.create(
    model="gpt-5.4",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "描述这张图片里有什么？用中文简短回答"},
            {"type": "image_url", "image_url": {"url": "https://i-blog.csdnimg.cn/img_convert/73ca3669cd115ec3fe3f7c39e2f0f3f6.png"}}
        ]
    }]
)
print(r.choices[0].message.content)
