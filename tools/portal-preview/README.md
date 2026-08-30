# Portal preview

Run the current checkout against read-only data from the MabelTV appliance:

```powershell
python tools/portal-preview/preview.py
```

Open `http://127.0.0.1:8099`. The harness serves portal assets from this
checkout, proxies GET and HEAD requests to the appliance, and rejects every
mutating request. It is intended for responsive visual work only.

If the appliance does not resolve as `mabeltv.local`, pass its portal URL:

```powershell
python tools/portal-preview/preview.py --appliance http://192.168.0.27:8080
```
