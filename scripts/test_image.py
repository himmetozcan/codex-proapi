from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:1455/v1",
    api_key="sk-"
)
r = client.images.generate(
    model="gpt-image-2",
    prompt="奥特曼与灰太狼",
    n=1,
    size="1024x1024"
)
# 输出图像代理 URL，浏览器可直接打开
print(r.data[0].url)
