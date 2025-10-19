# Web Bluetooth Browser Support

This document outlines the current state of Web Bluetooth API support across different browsers and the auto-discovery functionality in PigeonBluetooth.

## Browser Compatibility

### ✅ Chrome/Chromium (Fully Supported)
- **Auto-discovery**: ✅ Works with experimental requestLEScan API
- **Manual device selection**: ✅ Full support
- **RSSI signal strength**: ✅ Available in advertisements
- **Background scanning**: ✅ With duration limits
- **Configuration**: No special setup required on HTTPS/localhost

### ✅ Microsoft Edge (Fully Supported)
- **Auto-discovery**: ✅ Works with experimental requestLEScan API
- **Manual device selection**: ✅ Full support
- **RSSI signal strength**: ✅ Available in advertisements
- **Background scanning**: ✅ With duration limits
- **Configuration**: No special setup required on HTTPS/localhost

### ⚠️ Brave Browser (Partially Supported)
- **Auto-discovery**: ❌ Blocked by default privacy settings
- **Manual device selection**: ❌ Blocked by default privacy settings
- **Configuration Required**: 
  1. Navigate to `brave://settings/privacy`
  2. Go to "Site and Shields settings"
  3. Select "Additional permissions" → "Bluetooth"
  4. Set to "Allow sites to ask to connect"
  
  **Alternative**: Enable via `brave://flags/#enable-web-bluetooth-new-permissions-backend`

### ❌ Firefox (Not Supported)
- **Web Bluetooth API**: Not implemented
- **Status**: Mozilla has no plans to implement Web Bluetooth
- **Fallback**: Uses MockAdapter for testing UI functionality
- **Reason**: Privacy and security concerns

### ❌ Safari (Not Supported)
- **Web Bluetooth API**: Not implemented
- **Status**: Apple has not announced implementation plans
- **Fallback**: Uses MockAdapter for testing UI functionality
- **iOS Safari**: Also not supported

## Feature Support Matrix

| Feature | Chrome/Edge | Brave (configured) | Firefox | Safari |
|---------|-------------|-------------------|---------|--------|
| Basic Web Bluetooth | ✅ | ✅ | ❌ | ❌ |
| requestLEScan | ✅ | ✅ | ❌ | ❌ |
| RSSI in advertisements | ✅ | ✅ | ❌ | ❌ |
| Background scanning | ✅ | ✅ | ❌ | ❌ |
| Device name filtering | ✅ | ✅ | ❌ | ❌ |
| Auto-discovery | ✅ | ⚠️ | ❌ | ❌ |
| Manual selection | ✅ | ⚠️ | ❌ | ❌ |

## Auto-Discovery Features

### Experimental Scanning (Chrome/Edge)
The PigionBluetooth library implements advanced auto-discovery using the experimental `requestLEScan` API:

- **Continuous scanning**: Discovers devices as they become available
- **RSSI filtering**: Configurable signal strength thresholds
- **Name filtering**: Include/exclude devices based on name patterns
- **Scan duration**: Automatic timeout to prevent infinite scanning
- **Signal strength indicators**: Real-time RSSI values for device proximity

### Configuration Options
```typescript
const adapter = new WebBluetoothAdapter({
  autoDiscovery: true,        // Enable experimental scanning
  scanDuration: 30,           // Scan for 30 seconds max
  rssiThreshold: -80,         // Only devices stronger than -80dBm
  nameFilters: ['Arduino', 'ESP32'], // Only devices matching these patterns
  acceptAllDevices: true      // Fallback for manual selection
});
```

### Fallback Behavior
When auto-discovery is unavailable:
1. Connects to previously authorized devices
2. Prompts user for manual device selection
3. Falls back to MockAdapter for testing

## Testing Recommendations

1. **Primary Development**: Use Chrome or Edge for full feature testing
2. **Brave Testing**: Configure privacy settings or use flags
3. **Cross-browser Testing**: Use MockAdapter to verify UI functionality
4. **Production**: Detect browser capabilities and show appropriate messaging

## Implementation Notes

- The library gracefully degrades when Web Bluetooth is unavailable
- MockAdapter provides realistic simulation for unsupported browsers
- All discovery features work with real Bluetooth devices in supported browsers
- TypeScript definitions include proper browser compatibility types