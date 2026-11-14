package __PACKAGE__

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class AirSenseBleForegroundServiceModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
  override fun getName() = "AirSenseBleService"

  @ReactMethod
  fun start(promise: Promise) {
    try {
      val intent = Intent(context, AirSenseBleForegroundService::class.java)
      val locationGranted =
        context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
          PackageManager.PERMISSION_GRANTED ||
          context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
          PackageManager.PERMISSION_GRANTED
      intent.putExtra(
        AirSenseBleForegroundService.EXTRA_LOCATION_PERMISSION,
        locationGranted,
      )
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("E_AIRSENSE_SERVICE_START", error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      context.stopService(Intent(context, AirSenseBleForegroundService::class.java))
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("E_AIRSENSE_SERVICE_STOP", error)
    }
  }
}

class AirSenseBleForegroundServicePackage : ReactPackage {
  override fun createNativeModules(
    context: ReactApplicationContext,
  ): List<NativeModule> = listOf(AirSenseBleForegroundServiceModule(context))

  override fun createViewManagers(
    context: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
