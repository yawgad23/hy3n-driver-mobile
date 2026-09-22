from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
assets = root / "assets" / "images"
source = Path("/home/ubuntu/hy3n-rider-mobile/assets/images/rider-splash-logo.png")

logo = Image.open(source).convert("RGBA")
black = Image.new("RGBA", logo.size, (0, 0, 0, 255))
diff = ImageChops.difference(logo, black).convert("L")
box = diff.point(lambda p: 255 if p > 12 else 0).getbbox()
if box is None:
    raise RuntimeError("Could not find non-black logo content")
logo = logo.crop(box)

font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

def make_asset(size: int, logo_width: int, font_size: int, bottom_margin: int, logo_y_offset: int, out: Path):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 255))
    ratio = logo_width / logo.width
    resized = logo.resize((logo_width, round(logo.height * ratio)), Image.Resampling.LANCZOS)
    x = (size - resized.width) // 2
    y = (size - resized.height) // 2 + logo_y_offset
    canvas.alpha_composite(resized, (x, y))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype(font_path, font_size)
    text = "DRIVER"
    bbox = draw.textbbox((0, 0), text, font=font)
    tx = (size - (bbox[2] - bbox[0])) // 2
    ty = size - bottom_margin - (bbox[3] - bbox[1])
    draw.text((tx, ty), text, font=font, fill=(255, 255, 255, 255))
    canvas.convert("RGB").save(out, format="PNG", optimize=True)

make_asset(1024, 760, 74, 100, -70, assets / "icon.png")
make_asset(1920, 1320, 118, 180, -95, assets / "driver-splash-artwork.png")
for name in ("android-icon-foreground.png", "android-icon-monochrome.png"):
    Image.open(assets / "icon.png").save(assets / name, format="PNG", optimize=True)
