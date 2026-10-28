#!/usr/bin/env python3
"""
把上游公開星表轉成網站用的精簡資料檔。

用法：
  python3 -I space/tools/build_data.py \
      --hyg  <hyg-database 倉庫路徑> \
      --ngc  <OpenNGC 倉庫路徑> \
      --oec  <oec_tables 倉庫路徑> \
      --out  space/data

輸出：
  stars.json         平面陣列，每顆星 6 個值：x,y,z（秒差距，J2000 赤道座標）、視星等、B-V 色指數、HYG id
  stars_index.json   可搜尋的恆星索引（有專名、或視星等 < 6.5）
  dso.json           OpenNGC 全部 NGC/IC 天體（含梅西耶交叉編號、常用名、中文名）
  exoplanets.json    Open Exoplanet Catalogue 已確認系外行星
  meta.json          收錄數量、來源、上游版本、建置日期
"""
import argparse, csv, json, math, os, struct, subprocess, datetime

AP = argparse.ArgumentParser()
AP.add_argument('--hyg', required=True)
AP.add_argument('--ngc', required=True)
AP.add_argument('--oec', required=True)
AP.add_argument('--out', required=True)
A = AP.parse_args()
os.makedirs(A.out, exist_ok=True)

def git_info(path):
    try:
        h = subprocess.check_output(['git', '-C', path, 'rev-parse', 'HEAD'], text=True).strip()
        d = subprocess.check_output(['git', '-C', path, 'log', '-1', '--format=%cI'], text=True).strip()
        return {'commit': h, 'commit_date': d}
    except Exception as e:  # noqa
        return {'commit': None, 'commit_date': None, 'error': str(e)}

def fnum(s):
    try:
        if s is None or s == '':
            return None
        return float(s)
    except ValueError:
        return None

# ---------------------------------------------------------------- 中文名 ----
CON_ZH = {
 'And':'仙女座','Ant':'唧筒座','Aps':'天燕座','Aqr':'寶瓶座','Aql':'天鷹座','Ara':'天壇座','Ari':'白羊座','Aur':'御夫座',
 'Boo':'牧夫座','Cae':'雕具座','Cam':'鹿豹座','Cnc':'巨蟹座','CVn':'獵犬座','CMa':'大犬座','CMi':'小犬座','Cap':'摩羯座',
 'Car':'船底座','Cas':'仙后座','Cen':'半人馬座','Cep':'仙王座','Cet':'鯨魚座','Cha':'蝘蜓座','Cir':'圓規座','Col':'天鴿座',
 'Com':'后髮座','CrA':'南冕座','CrB':'北冕座','Crv':'烏鴉座','Crt':'巨爵座','Cru':'南十字座','Cyg':'天鵝座','Del':'海豚座',
 'Dor':'劍魚座','Dra':'天龍座','Equ':'小馬座','Eri':'波江座','For':'天爐座','Gem':'雙子座','Gru':'天鶴座','Her':'武仙座',
 'Hor':'時鐘座','Hya':'長蛇座','Hyi':'水蛇座','Ind':'印第安座','Lac':'蝎虎座','Leo':'獅子座','LMi':'小獅座','Lep':'天兔座',
 'Lib':'天秤座','Lup':'豺狼座','Lyn':'天貓座','Lyr':'天琴座','Men':'山案座','Mic':'顯微鏡座','Mon':'麒麟座','Mus':'蒼蠅座',
 'Nor':'矩尺座','Oct':'南極座','Oph':'蛇夫座','Ori':'獵戶座','Pav':'孔雀座','Peg':'飛馬座','Per':'英仙座','Phe':'鳳凰座',
 'Pic':'繪架座','Psc':'雙魚座','PsA':'南魚座','Pup':'船尾座','Pyx':'羅盤座','Ret':'網罟座','Sge':'天箭座','Sgr':'人馬座',
 'Sco':'天蠍座','Scl':'玉夫座','Sct':'盾牌座','Ser':'巨蛇座','Sex':'六分儀座','Tau':'金牛座','Tel':'望遠鏡座','Tri':'三角座',
 'TrA':'南三角座','Tuc':'杜鵑座','UMa':'大熊座','UMi':'小熊座','Vel':'船帆座','Vir':'室女座','Vol':'飛魚座','Vul':'狐狸座',
}
STAR_ZH = {
 'Sirius':'天狼星','Canopus':'老人星','Rigil Kentaurus':'南門二','Arcturus':'大角星','Vega':'織女一','Capella':'五車二',
 'Rigel':'參宿七','Procyon':'南河三','Achernar':'水委一','Betelgeuse':'參宿四','Hadar':'馬腹一','Altair':'河鼓二',
 'Acrux':'十字架二','Aldebaran':'畢宿五','Antares':'心宿二','Spica':'角宿一','Pollux':'北河三','Fomalhaut':'北落師門',
 'Deneb':'天津四','Mimosa':'十字架三','Regulus':'軒轅十四','Adhara':'弧矢七','Castor':'北河二','Gacrux':'十字架一',
 'Shaula':'尾宿八','Bellatrix':'參宿五','Elnath':'五車五','Miaplacidus':'南船五','Alnilam':'參宿二','Alnair':'鶴一',
 'Alnitak':'參宿一','Alioth':'玉衡','Dubhe':'天樞','Mirfak':'天船三','Wezen':'弧矢一','Sargas':'尾宿五','Kaus Australis':'箕宿三',
 'Avior':'海石一','Alkaid':'搖光','Menkalinan':'五車三','Atria':'三角形三','Alhena':'井宿三','Peacock':'孔雀十一',
 'Alsephina':'天社一','Mirzam':'軍市一','Alphard':'星宿一','Polaris':'北極星','Hamal':'婁宿三','Algieba':'軒轅十二',
 'Diphda':'土司空','Mizar':'開陽','Nunki':'斗宿四','Menkent':'庫樓三','Mirach':'奎宿九','Alpheratz':'壁宿二','Rasalhague':'候',
 'Kochab':'北極二','Saiph':'參宿六','Denebola':'五帝座一','Algol':'大陵五','Tiaki':'鶴二','Muhlifain':'庫樓七',
 'Aspidiske':'海石二','Suhail':'天記','Alphecca':'貫索四','Mintaka':'參宿三','Sadr':'天津一','Eltanin':'天棓四',
 'Schedar':'王良四','Naos':'弧矢增二十二','Almach':'天大將軍一','Caph':'王良一','Izar':'梗河一','Dschubba':'房宿三',
 'Larawag':'尾宿二','Merak':'天璇','Ankaa':'火鳥六','Girtab':'尾宿三','Enif':'危宿三','Scheat':'室宿二','Sabik':'宋',
 'Phecda':'天璣','Aludra':'弧矢二','Markeb':'天社五','Markab':'室宿一','Aljanah':'天津九','Acrab':'房宿四',
 'Proxima Centauri':'比鄰星','Toliman':'南門二B','Barnard\'s Star':'巴納德星','Wolf 359':'沃夫359','Lalande 21185':'拉朗德21185',
 'Tau Ceti':'天倉五','Epsilon Eridani':'天苑四','Alcyone':'昴宿六','Thuban':'右樞','Albireo':'輦道增七','Zubenelgenubi':'氐宿一',
 'Zubeneschamali':'氐宿四','Alderamin':'天鉤五','Rastaban':'天棓三','Cebalrai':'宗正一','Unukalhai':'蜀','Yed Prior':'梁',
 'Sheratan':'婁宿一','Algenib':'壁宿一','Ruchbah':'閣道三','Segin':'閣道二','Tarazed':'河鼓三','Alshain':'河鼓一',
 'Sulafat':'漸台三','Sheliak':'漸台二','Vindemiatrix':'東次將','Porrima':'東上相','Zosma':'西上相','Chertan':'西次相',
 'Alnasl':'箕宿一','Ascella':'斗宿六','Kaus Media':'箕宿二','Kaus Borealis':'斗宿二','Wasat':'天樽二','Mebsuta':'井宿五',
 'Propus':'鉞','Tejat':'井宿一','Alzirr':'井宿七','Mekbuda':'井宿四','Nekkar':'七公增五','Seginus':'招搖','Muphrid':'右攝提一',
 'Cor Caroli':'常陳一','Alkalurops':'七公六','Rasalgethi':'帝座','Kornephoros':'河中','Sarin':'魏','Nashira':'壘壁陣三',
 'Deneb Algedi':'壘壁陣四','Dabih':'牛宿一','Algedi':'牛宿二','Sadalsuud':'虛宿一','Sadalmelik':'危宿一','Skat':'羽林軍二十六',
 'Ain':'畢宿一','Electra':'昴宿一','Maia':'昴宿四','Merope':'昴宿五','Taygeta':'昴宿二','Pleione':'昴宿增十二','Atlas':'昴宿七',
 'Celaeno':'昴宿三','Asterope':'昴宿增九','Meissa':'觜宿一','Phact':'丈人一','Furud':'孫增一','Alula Borealis':'下台二',
 'Tania Australis':'中台二','Talitha':'上台一','Megrez':'天權','Alcor':'輔','Alkes':'翼宿一','Gienah':'軫宿一','Algorab':'軫宿三',
 'Kraz':'軫宿四','Minkar':'軫宿二','Zaurak':'天苑一','Cursa':'玉井三','Acamar':'天園六','Arneb':'廁一','Nihal':'廁二',
 'Alhaud':'','Vindemiatrix ':'東次將','Heze':'角宿二','Syrma':'亢宿二','Kang':'亢宿四','Mufrid':'右攝提一','Botein':'天陰四',
 'Mesarthim':'婁宿二','Bharani':'胃宿三','Menkar':'天囷一','Kaffaljidhma':'天囷八','Baten Kaitos':'天倉四','Fornacis':'',
 'Achird':'王良三','Navi':'策','Tsih':'策','Ran':'天苑四','Keid':'九州殊口增七','Beid':'九州殊口增六','Azha':'天苑六',
 'Rana':'天苑三','Theemin':'天園十一','Avior ':'海石一','Tureis':'海石二','Regor':'天社三','Alsuhail':'天記','Koo She':'天社一',
 'Markab ':'室宿一','Homam':'雷電一','Matar':'離宮四','Biham':'危宿二','Sadalbari':'離宮二','Baham':'危宿二',
 'Alrescha':'外屏七','Fumalsamakah':'霹靂一','Torcular':'外屏二','Revati':'外屏五','Kitalpha':'虛宿二','Rotanev':'瓠瓜一','Sualocin':'瓠瓜四',
 'Albali':'女宿一','Ancha':'天壘城一','Situla':'天壘城二','Sadachbia':'墳墓二','Alnitak ':'參宿一','Hassaleh':'五車一','Almaaz':'柱一',
 'Haedus':'柱二','Saclateni':'柱三','Mahasim':'五車四','Zubenelhakrabi':'氐宿二','Brachium':'氐宿三','Jabbah':'房宿二',
 'Alniyat':'心宿一','Paikauhale':'心宿三','Lesath':'尾宿九','Fuyue':'傅說','Xamidimura':'尾宿一','Pipirima':'尾宿一B',
 'Iklil':'西咸三','Fang':'房宿四','Wei':'尾宿二','Polis':'斗宿三','Arkab Prior':'天淵一','Arkab Posterior':'天淵二','Rukbat':'天淵三',
 'Albaldah':'建三','Terebellum':'狗國四','Sham':'左旗五','Anser':'齊增五','Alya':'徐','Tianyi':'天一','Taiyi':'太一',
 'Giausar':'天棓增一','Edasich':'紫微左垣一','Aldhibah':'天廚一','Grumium':'天棓一','Kuma':'天棓二','Athebyne':'天廚三',
 'Alrakis':'天棓增九','Dziban':'天廚二','Pherkad':'北極一','Yildun':'北極四','Errai':'少衛增八','Alfirk':'上衛增一',
 'Kurhah':'天鉤六','Castula':'王良增三','Fulu':'附路','Muscida':'內階一','Tania Borealis':'中台一','Alula Australis':'下台一',
 'Taiyangshou':'太陽守','Chalawan':'太尊','Intercrus':'文昌四','Praecipua':'勢四','Subra':'軒轅九','Rasalas':'軒轅十一',
 'Adhafera':'軒轅十三','Alterf':'軒轅七','Diadem':'周鼎一','Zavijava':'右執法','Zaniah':'左執法','Minelauva':'東次相',
 'Elgafar':'太微左垣四','Khambalia':'亢宿增七','Nusakan':'貫索三','Marsic':'天紀增二','Maasym':'天紀二','Cujam':'天紀增一',
 'Rasalhague ':'候','Yed Posterior':'楚','Marfik':'天市右垣七','Guniibuu':'宗人四','Imai':'十字架四','Ginan':'十字架增一',
 'Hadar ':'馬腹一','Birdun':'庫樓二','Meridiana':'鱉六','Bunda':'壘壁陣五','Fawaris':'天津二','Azelfafage':'螣蛇一',
 'Alshat':'牛宿增二','Nashira ':'壘壁陣三','Tabit':'參旗六','Thabit':'伐三','Hatysa':'伐二','Alnilam ':'參宿二','Mintaka ':'參宿三',
 'Ras Elased Australis':'軒轅九','Elkurud':'','Wazn':'子二','Wurren':'','Felis':'','Lucilinburhuc':'','Mothallah':'婁宿增六',
 'Alpherg':'外屏三','Alsafi':'天廚增三','Alnasl ':'箕宿一','Alkaid ':'搖光','Tonatiuh':'','Chamukuy':'畢宿四','Prima Hyadum':'畢宿三','Secunda Hyadum':'畢宿二',
}
STAR_ZH = {k.strip(): v for k, v in STAR_ZH.items() if v}

DSO_ZH = {
 'M1':'蟹狀星雲','M2':'寶瓶座球狀星團 M2','M3':'獵犬座球狀星團 M3','M4':'天蠍座球狀星團 M4','M5':'巨蛇座球狀星團 M5','M6':'蝴蝶星團',
 'M7':'托勒密星團','M8':'礁湖星雲','M11':'野鴨星團','M13':'武仙座大球狀星團','M15':'飛馬座球狀星團 M15','M16':'老鷹星雲',
 'M17':'天鵝星雲（Ω 星雲）','M20':'三裂星雲','M22':'人馬座球狀星團 M22','M24':'人馬座恆星雲','M27':'啞鈴星雲','M31':'仙女座星系',
 'M32':'仙女座星系伴星系 M32','M33':'三角座星系','M35':'雙子座疏散星團 M35','M36':'御夫座疏散星團 M36','M37':'御夫座疏散星團 M37',
 'M38':'御夫座疏散星團 M38','M41':'大犬座疏散星團 M41','M42':'獵戶座大星雲','M43':'德邁蘭星雲','M44':'鬼宿星團（蜂巢星團）',
 'M45':'昴宿星團（七姊妹）','M46':'船尾座疏散星團 M46','M47':'船尾座疏散星團 M47','M49':'室女座橢圓星系 M49','M51':'渦狀星系',
 'M52':'仙后座疏散星團 M52','M57':'環狀星雲','M63':'向日葵星系','M64':'黑眼星系','M65':'獅子座三重星系 M65','M66':'獅子座三重星系 M66',
 'M67':'巨蟹座疏散星團 M67','M74':'雙魚座螺旋星系 M74','M76':'小啞鈴星雲','M77':'鯨魚座 A（M77）','M78':'獵戶座反射星雲 M78',
 'M81':'波德星系','M82':'雪茄星系','M83':'南風車星系','M84':'室女座星系團 M84','M86':'室女座星系團 M86','M87':'室女座 A（M87）',
 'M92':'武仙座球狀星團 M92','M94':'獵犬座星系 M94','M95':'獅子座棒旋星系 M95','M96':'獅子座螺旋星系 M96','M97':'夜梟星雲',
 'M100':'后髮座螺旋星系 M100','M101':'風車星系','M104':'草帽星系','M106':'獵犬座星系 M106','M108':'衝浪板星系','M109':'大熊座棒旋星系 M109','M110':'仙女座星系伴星系 M110',
 'NGC0253':'玉夫座星系（銀幣星系）','NGC0292':'小麥哲倫星系','NGC0869':'英仙座雙星團 h','NGC0884':'英仙座雙星團 χ','NGC1976':'獵戶座大星雲',
 'NGC2070':'蜘蛛星雲','NGC2237':'玫瑰星雲','NGC2244':'玫瑰星雲星團','NGC2392':'愛斯基摩星雲','NGC3372':'船底座大星雲（海山二星雲）',
 'NGC4594':'草帽星系','NGC5128':'半人馬座 A','NGC5139':'半人馬座 ω 球狀星團','NGC6302':'蝴蝶星雲（臭蟲星雲）','NGC6543':'貓眼星雲',
 'NGC6720':'環狀星雲','NGC6853':'啞鈴星雲','NGC6960':'面紗星雲（西）','NGC6992':'面紗星雲（東）','NGC7000':'北美洲星雲',
 'NGC7009':'土星狀星雲','NGC7293':'螺旋星雲','NGC7331':'飛馬座螺旋星系 NGC 7331','NGC7635':'氣泡星雲','NGC7662':'藍雪球星雲',
 'NGC0104':'杜鵑座 47 球狀星團','NGC0224':'仙女座星系','NGC0598':'三角座星系','NGC1952':'蟹狀星雲','NGC5194':'渦狀星系',
 'NGC3031':'波德星系','NGC3034':'雪茄星系','NGC5457':'風車星系','NGC4486':'室女座 A（M87）','NGC2024':'火焰星雲','NGC1499':'加州星雲',
 'IC0434':'馬頭星雲（背景星雲）','IC1396':'象鼻星雲','IC0405':'燃燒之星星雲','IC2944':'奔跑的雞星雲','IC5146':'繭星雲','IC1805':'心臟星雲','IC1848':'靈魂星雲','IC0443':'水母星雲','IC2118':'女巫頭星雲','IC4703':'老鷹星雲',
}

# 已發表距離（手動整理，單位 kpc；用於 OpenNGC 沒有可靠距離的著名天體）
DSO_DIST_KPC = {
 'M1':2.0,'M2':11.5,'M3':10.4,'M4':1.85,'M5':7.5,'M6':0.49,'M7':0.30,'M8':1.25,'M11':1.9,'M13':7.1,'M15':10.4,'M16':1.7,
 'M17':1.6,'M20':1.3,'M22':3.2,'M27':0.38,'M31':765,'M32':763,'M33':840,'M35':0.85,'M36':1.3,'M37':1.4,'M38':1.1,'M41':0.70,
 'M42':0.412,'M43':0.49,'M44':0.19,'M45':0.136,'M46':1.5,'M47':0.49,'M49':17100,'M51':7000,'M52':1.4,'M57':0.79,'M63':8900,
 'M64':5300,'M65':10700,'M66':11000,'M67':0.85,'M74':9500,'M77':14400,'M78':0.42,'M81':3630,'M82':3530,'M83':4600,'M84':18400,
 'M86':15900,'M87':16400,'M92':8.3,'M94':4900,'M95':10000,'M96':9600,'M97':0.62,'M100':16800,'M101':6400,'M104':9550,
 'M106':7200,'M108':14000,'M109':25500,'M110':780,'NGC0253':3500,'NGC0292':61,'NGC0869':2.3,'NGC0884':2.3,'NGC2070':49.6,
 'NGC2237':1.6,'NGC2244':1.6,'NGC2392':1.3,'NGC3372':2.6,'NGC5128':3800,'NGC5139':5.2,'NGC6302':1.0,'NGC6543':1.0,
 'NGC6960':0.74,'NGC6992':0.74,'NGC7000':0.8,'NGC7009':1.2,'NGC7293':0.20,'NGC7331':12200,'NGC7635':2.2,'NGC7662':1.7,
 'NGC0104':4.5,'NGC2024':0.41,'NGC1499':0.30,'IC0434':0.42,'IC1396':0.75,'IC0405':0.46,'IC2944':1.8,'IC5146':1.0,'IC1805':2.3,'IC1848':2.3,'IC0443':1.5,'IC2118':0.27,
}

# ---------------------------------------------------------------- 恆星 ----
hyg_csv = os.path.join(A.hyg, 'hyg', 'CURRENT', 'hygdata_v41.csv')
bin_rows = []
index = []
n_total = 0
with open(hyg_csv, newline='') as f:
    for row in csv.DictReader(f):
        if row['id'] == '0':
            continue  # 太陽另外處理
        n_total += 1
        mag = fnum(row['mag'])
        if mag is None:
            continue
        proper = row['proper'].strip()
        if mag > 8.0 and not proper:
            continue
        x, y, z = fnum(row['x']), fnum(row['y']), fnum(row['z'])
        ci = fnum(row['ci'])
        if ci is None:
            ci = 0.6
        dist = fnum(row['dist'])
        if dist is not None and dist >= 100000:
            dist = None  # HYG 以 100000 pc 表示未知距離
        bi = len(bin_rows)
        bin_rows.append((x, y, z, mag, ci, int(row['id'])))
        if mag < 6.5 or proper:
            bayer = row['bayer'].strip(); flam = row['flam'].strip(); con = row['con'].strip()
            desig = ' '.join(p for p in [bayer or flam, con] if p) if (bayer or flam) else ''
            entry = {
                'i': bi, 'id': int(row['id']), 'm': round(mag, 2),
                'ra': round(float(row['ra']) * 15.0, 5), 'dec': round(float(row['dec']), 5),
                'x': round(x, 4), 'y': round(y, 4), 'z': round(z, 4),
                'd': (round(dist, 3) if dist is not None else None),
                'sp': row['spect'].strip() or None, 'ci': round(ci, 3),
                'con': con or None,
            }
            if proper: entry['n'] = proper
            if proper in STAR_ZH: entry['zh'] = STAR_ZH[proper]
            if desig: entry['b'] = desig
            if row['hip']: entry['hip'] = int(float(row['hip']))
            if row['hd']: entry['hd'] = int(float(row['hd']))
            if row['hr']: entry['hr'] = int(float(row['hr']))
            if row['gl'].strip(): entry['gl'] = row['gl'].strip()
            am = fnum(row['absmag'])
            if am is not None: entry['am'] = round(am, 2)
            lum = fnum(row['lum'])
            if lum is not None: entry['lum'] = round(lum, 4)
            index.append(entry)

# 以 JSON 平面陣列輸出（每顆 6 個值），靜態托管環境不一定允許二進位檔
flat = []
for r in bin_rows:
    flat.extend([round(r[0], 4), round(r[1], 4), round(r[2], 4), round(r[3], 2), round(r[4], 3), r[5]])
with open(os.path.join(A.out, 'stars.json'), 'w') as f:
    json.dump(flat, f, separators=(',', ':'))
with open(os.path.join(A.out, 'stars_index.json'), 'w', encoding='utf-8') as f:
    json.dump(index, f, ensure_ascii=False, separators=(',', ':'))
print('stars: total', n_total, 'rendered', len(bin_rows), 'indexed', len(index))

# ---------------------------------------------------------------- 深空天體 ----
def parse_ra(s):
    h, m, sec = s.split(':'); return (float(h) + float(m) / 60 + float(sec) / 3600) * 15.0
def parse_dec(s):
    sign = -1 if s.strip().startswith('-') else 1
    d, m, sec = s.strip().lstrip('+-').split(':')
    return sign * (float(d) + float(m) / 60 + float(sec) / 3600)

TYPE_ZH = {
 'G':'星系','GPair':'星系對','GTrpl':'三重星系','GGroup':'星系群','OCl':'疏散星團','GCl':'球狀星團','Cl+N':'星團＋星雲',
 'PN':'行星狀星雲','Neb':'星雲','HII':'電離氫區','RfN':'反射星雲','EmN':'發射星雲','DrkN':'暗星雲','SNR':'超新星殘骸',
 '*':'恆星','**':'雙星','*Ass':'星協','Nova':'新星','Other':'其他','Dup':'重複','NonEx':'不存在',
}
dso = []
ngc_csv = os.path.join(A.ngc, 'database_files', 'NGC.csv')
with open(ngc_csv, newline='') as f:
    for row in csv.DictReader(f, delimiter=';'):
        t = row['Type']
        if t in ('Dup', 'NonEx'):
            continue
        name = row['Name']
        e = {'id': name, 't': t, 'ra': round(parse_ra(row['RA']), 5), 'dec': round(parse_dec(row['Dec']), 5)}
        if row['Const']: e['con'] = row['Const']
        if row['M']: e['m'] = int(row['M'])
        if row['NGC'] and name.startswith('IC'): e['ngc'] = row['NGC']
        if row['IC'] and name.startswith('NGC'): e['ic'] = row['IC']
        for k, src in (('maj', 'MajAx'), ('min', 'MinAx'), ('pa', 'PosAng'), ('vm', 'V-Mag'), ('bm', 'B-Mag'), ('sb', 'SurfBr')):
            v = fnum(row[src])
            if v is not None: e[k] = v
        if row['Hubble']: e['hub'] = row['Hubble']
        z = fnum(row['Redshift']); pax = fnum(row['Pax'])
        dist_kpc = None; dsrc = None
        key_m = ('M%d' % e['m']) if 'm' in e else None
        if key_m and key_m in DSO_DIST_KPC:
            dist_kpc = DSO_DIST_KPC[key_m]; dsrc = 'lit'
        elif name in DSO_DIST_KPC:
            dist_kpc = DSO_DIST_KPC[name]; dsrc = 'lit'
        elif pax and pax > 0:
            dist_kpc = 1.0 / pax; dsrc = 'parallax'  # Pax 單位 mas → kpc
        elif z and z > 0.0005:
            # 哈伯定律粗估（H0 = 70 km/s/Mpc，低紅移近似）
            dist_kpc = (z * 299792.458 / 70.0) * 1000.0; dsrc = 'redshift'
        if dist_kpc is not None:
            e['dk'] = round(dist_kpc, 4); e['ds'] = dsrc
        if z is not None: e['z'] = z
        names = [n for n in row['Common names'].split(',') if n.strip()]
        if names: e['n'] = [n.strip() for n in names]
        zh = DSO_ZH.get(key_m) if key_m else None
        if not zh: zh = DSO_ZH.get(name)
        if zh: e['zh'] = zh
        if row['Identifiers']:
            ids = [i.strip() for i in row['Identifiers'].split(',') if i.strip()]
            keep = [i for i in ids if i.split(' ')[0] in ('C', 'Mel', 'Cr', 'LBN', 'Sh2', 'PGC', 'UGC', 'MCG', 'Caldwell', 'B', 'Ced', 'LDN')]
            if keep: e['alt'] = keep[:6]
        dso.append(e)
with open(os.path.join(A.out, 'dso.json'), 'w', encoding='utf-8') as f:
    json.dump(dso, f, ensure_ascii=False, separators=(',', ':'))
print('dso:', len(dso), 'with distance', sum(1 for d in dso if 'dk' in d), 'messier', sum(1 for d in dso if 'm' in d))

# ---------------------------------------------------------------- 系外行星 ----
def parse_hms(s):
    p = s.split();
    if len(p) < 3: return None
    return (float(p[0]) + float(p[1]) / 60 + float(p[2]) / 3600) * 15.0
def parse_dms(s):
    p = s.split()
    if len(p) < 3: return None
    sign = -1 if p[0].startswith('-') else 1
    return sign * (abs(float(p[0])) + float(p[1]) / 60 + float(p[2]) / 3600)

exo = []
oec_csv = os.path.join(A.oec, 'comma_separated', 'open_exoplanet_catalogue.txt')
with open(oec_csv, newline='') as f:
    for row in csv.DictReader(f):
        if 'Confirmed' not in row['list']:
            continue
        ra = parse_hms(row['system_rightascension']) if row['system_rightascension'] else None
        dec = parse_dms(row['system_declination']) if row['system_declination'] else None
        if ra is None or dec is None:
            continue
        e = {'n': row['name'], 'ra': round(ra, 5), 'dec': round(dec, 5)}
        for k, src in (('mj', 'mass'), ('rj', 'radius'), ('p', 'period'), ('a', 'semimajoraxis'), ('e', 'eccentricity'),
                       ('T', 'temperature'), ('d', 'system_distance'), ('sm', 'hoststar_mass'), ('sr', 'hoststar_radius'),
                       ('sT', 'hoststar_temperature'), ('inc', 'inclination')):
            v = fnum(row[src])
            if v is not None: e[k] = v
        if row['discoverymethod']: e['dm'] = row['discoverymethod']
        if row['discoveryyear']: e['dy'] = int(float(row['discoveryyear']))
        if row['lastupdate']: e['lu'] = row['lastupdate']
        bf = row['binaryflag']
        if bf and bf != '0': e['bin'] = int(bf)
        exo.append(e)
with open(os.path.join(A.out, 'exoplanets.json'), 'w', encoding='utf-8') as f:
    json.dump(exo, f, ensure_ascii=False, separators=(',', ':'))
print('exoplanets:', len(exo), 'with distance', sum(1 for e in exo if 'd' in e), 'with radius', sum(1 for e in exo if 'rj' in e))

# ---------------------------------------------------------------- meta ----
meta = {
    'built': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
    'counts': {
        'stars_total_in_hyg': n_total, 'stars_rendered': len(bin_rows), 'stars_searchable': len(index),
        'dso': len(dso), 'dso_with_distance': sum(1 for d in dso if 'dk' in d), 'messier': sum(1 for d in dso if 'm' in d),
        'exoplanets': len(exo),
    },
    'sources': {
        'hyg': {'name': 'HYG Database v4.1 (Hipparcos / Yale BSC / Gliese)', 'url': 'https://github.com/astronexus/HYG-Database',
                'license': 'CC BY-SA 4.0', **git_info(A.hyg)},
        'openngc': {'name': 'OpenNGC (NGC / IC 目錄，含梅西耶交叉編號)', 'url': 'https://github.com/mattiaverga/OpenNGC',
                    'license': 'CC BY-SA 4.0', **git_info(A.ngc)},
        'oec': {'name': 'Open Exoplanet Catalogue (ASCII tables)', 'url': 'https://github.com/OpenExoplanetCatalogue/oec_tables',
                'license': 'MIT（資料可自由使用，需註明）', **git_info(A.oec)},
    },
    'notes': [
        '恆星：只收錄視星等 ≤ 8.0 或有專名者；位置為 J2000 赤道座標，距離來自 Hipparcos/Gaia 視差（HYG 未知距離者顯示未知）。',
        '深空天體：OpenNGC 全部 NGC/IC（排除重複與不存在項目）；距離依序取「文獻值（手動整理）」、「視差」、「紅移（哈伯定律 H0=70 粗估）」，其餘顯示未知。',
        '系外行星：Open Exoplanet Catalogue 2023-10 版「已確認」清單；僅有軌道與大小資料，外觀皆為推測。',
        '未涵蓋：PGC/UGC 等更暗星系、Gaia 完整星表、星系團目錄、系外行星最新發現（NASA Exoplanet Archive 在建置環境無法連線）。',
    ],
}
with open(os.path.join(A.out, 'meta.json'), 'w', encoding='utf-8') as f:
    json.dump(meta, f, ensure_ascii=False, indent=1)
print('meta written')
