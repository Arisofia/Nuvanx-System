import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Phone, MessageSquare, AlertTriangle, CheckCircle2, Copy, ExternalLink, Info } from 'lucide-react'
import { toast } from 'react-hot-toast'

export default function SalesPlaybook() {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copiado al portapapeles')
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Manual Operativo: Endolift®</h1>
          <p className="text-muted mt-1 italic text-sm">NUVANX Medicina Estética Láser — Clínica Premium</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => window.open('https://calendar.app.google/j6U4YiYvJSttNX836', '_blank')}>
            <ExternalLink className="w-4 h-4" />
            Ver Agenda
          </Button>
        </div>
      </div>

      <Tabs defaultValue="llamada">
        <TabsList className="mb-4">
          <TabsTrigger value="llamada" className="gap-2">
            <Phone className="w-4 h-4" />
            Flujo de Llamada
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-2">
            <MessageSquare className="w-4 h-4" />
            Plantillas WhatsApp
          </TabsTrigger>
          <TabsTrigger value="objeciones" className="gap-2">
            <AlertTriangle className="w-4 h-4" />
            Objeciones
          </TabsTrigger>
          <TabsTrigger value="info" className="gap-2">
            <Info className="w-4 h-4" />
            Info Tratamiento
          </TabsTrigger>
        </TabsList>

        <TabsContent value="llamada" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>1. Apertura y Calificación</CardTitle>
              <CardDescription>Objetivo: Entender la zona y generar interés sin vender agresivamente.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted/30 p-4 rounded-lg border-l-4 border-primary">
                <p className="font-semibold mb-2">Saludo Inicial:</p>
                <p className="italic">"Hola, ¿hablo con [Nombre]? Soy [Tu Nombre] de NUVANX Medicina Estética Láser. Te llamo porque dejaste tus datos solicitando información sobre Endolift®. ¿Tienes un minuto para que pueda orientarte?"</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="font-semibold text-sm uppercase tracking-wider text-muted">Si dice que SÍ:</p>
                  <p className="text-sm">"Perfecto. La idea no es venderte nada por teléfono, sino entender qué zona te interesa y explicarte si Endolift® podría tener sentido para tu caso."</p>
                </div>
                <div className="space-y-2">
                  <p className="font-semibold text-sm uppercase tracking-wider text-muted">Si dice que NO (ahora no puede):</p>
                  <p className="text-sm">"Sin problema. Si te parece, te escribo por WhatsApp para que tengas nuestro número guardado y por ahí me cuentas qué zona quieres valorar."</p>
                </div>
              </div>

              <div className="space-y-2 pt-4 border-t">
                <p className="font-semibold">Cualificación Rápida (Máx. 4 preguntas):</p>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  <li>¿Qué zona te preocupa más? (Papada, abdomen, brazos...)</li>
                  <li>¿Buscas mejorar firmeza, contorno, grasa o todo?</li>
                  <li>¿Te has hecho antes algún tratamiento en esa zona?</li>
                  <li>¿Alguna condición médica (marcapasos, anticoagulantes, embarazo)?</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Cierre de Llamada</CardTitle>
              <CardDescription>Objetivo: Transicionar a WhatsApp para fotos o agendar directamente.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
                <p className="font-semibold text-primary mb-2">Opción A: Pedir Fotos (Recomendado)</p>
                <p className="text-sm mb-3">"Lo más práctico es que te escriba por WhatsApp. Si nos envías 2 o 3 fotos claras de la zona, podemos hacer una orientación aproximada antes de la valoración presencial."</p>
                <Button size="sm" variant="outline" className="gap-2" onClick={() => copyToClipboard('Lo más práctico ahora es que te escriba por WhatsApp para que tengas nuestro número guardado. Si nos envías 2 o 3 fotos claras de la zona, con buena luz y sin filtros, podemos hacer una primera orientación aproximada y decirte qué opción podría tener más sentido para ti.')}>
                  <Copy className="w-3 h-3" /> Copiar Cierre
                </Button>
              </div>

              <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
                <p className="font-semibold text-primary mb-2">Opción B: Agenda Directa</p>
                <p className="text-sm mb-3">"Si prefieres avanzar, puedes agendar directamente tu valoración gratuita en Clínica Chamberí. Te envío el enlace por WhatsApp ahora mismo."</p>
                <Button size="sm" variant="outline" className="gap-2" onClick={() => copyToClipboard('Si te parece, también puedes agendar directamente tu valoración informativa gratuita para que el doctor revise tu caso en clínica. Estamos en Clínica Chamberí, en C/ de Fernández de la Hoz, 4 Bajo Derecha, 28010 Madrid. Te envío ahora mismo el enlace por WhatsApp para que elijas el horario que mejor te venga: https://calendar.app.google/j6U4YiYvJSttNX836')}>
                  <Copy className="w-3 h-3" /> Copiar Cierre
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="whatsapp" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg">Post-Llamada (General)</CardTitle>
                  <Button variant="ghost" size="icon" onClick={() => copyToClipboard(`Hola, [Nombre]. Soy [Tu Nombre] de NUVANX Medicina Estética Láser.
Gracias por atendernos.

Como comentamos, puedes enviarnos por este WhatsApp fotos claras de la zona que deseas valorar para darte una primera orientación aproximada.

Idealmente, envíanos:
- Foto de frente
- Foto de perfil derecho
- Foto de perfil izquierdo
- Una foto adicional de la zona que más te preocupa

Con buena luz, sin filtros y con postura natural.

Si lo prefieres, también puedes agendar directamente tu valoración informativa gratuita aquí:
https://calendar.app.google/j6U4YiYvJSttNX836

Quedamos atentos.`)}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap font-sans text-muted-foreground">
                  Hola, [Nombre]. Soy [Tu Nombre] de NUVANX...
                </pre>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg">Zona Facial / Cuello</CardTitle>
                  <Button variant="ghost" size="icon" onClick={() => copyToClipboard(`Hola, [Nombre]. Soy [Tu Nombre] de NUVANX Medicina Estética Láser.
Como comentamos, puedes enviarnos por este WhatsApp fotos claras de papada, cuello y perfil mandibular para darte una primera orientación.

Por favor, envíanos:
- Foto de frente, con rostro y cuello visibles
- Foto de perfil derecho
- Foto de perfil izquierdo
- Foto mirando ligeramente hacia abajo

Lo ideal es que sean con buena luz, sin filtros, con el cabello recogido y la cámara a la altura del rostro.

Si lo prefieres, también puedes agendar directamente tu valoración informativa gratuita aquí:
https://calendar.app.google/j6U4YiYvJSttNX836

Quedamos atentos.`)}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap font-sans text-muted-foreground">
                  Hola, [Nombre]. Soy [Tu Nombre] de NUVANX... (Variante facial)
                </pre>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg">Cuerpo (Abdomen/Flancos)</CardTitle>
                  <Button variant="ghost" size="icon" onClick={() => copyToClipboard(`Hola, [Nombre]. Soy [Tu Nombre] de NUVANX Medicina Estética Láser.
Como comentamos, podemos valorar abdomen inferior y flancos para ayudarte a definir mejor la silueta.

Si te parece, envíanos por este WhatsApp unas fotos claras:
- De frente, desde debajo del pecho hasta la cadera
- De perfil derecho
- De perfil izquierdo
- De espalda o 3/4 posterior

Lo ideal es que sean con buena luz, sin filtros, de pie y con ropa ajustada.

Si lo prefieres, también puedes agendar directamente tu valoración informativa gratuita aquí:
https://calendar.app.google/j6U4YiYvJSttNX836

Quedamos atentos.`)}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap font-sans text-muted-foreground">
                  Hola, [Nombre]. Soy [Tu Nombre] de NUVANX... (Variante cuerpo)
                </pre>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg">Si NO contesta llamada</CardTitle>
                  <Button variant="ghost" size="icon" onClick={() => copyToClipboard(`Hola, [Nombre]. Soy [Tu Nombre] de NUVANX Medicina Estética Láser.
Hemos intentado llamarte porque nos dejaste tus datos solicitando información sobre Endolift®.

Si te parece, puedes respondernos por este WhatsApp indicándonos qué zona deseas valorar, y si quieres también puedes enviarnos fotos claras para darte una primera orientación aproximada.

Si te resulta más cómodo, también puedes agendar directamente tu valoración informativa gratuita aquí:
https://calendar.app.google/j6U4YiYvJSttNX836

Quedamos atentos.`)}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap font-sans text-muted-foreground">
                  Hola, [Nombre]. Hemos intentado llamarte...
                </pre>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="objeciones" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              {
                q: "¿Cuánto cuesta?",
                a: "El precio depende de la zona y de si es una zona aislada o combinación. Para darte una orientación responsable, primero necesitamos saber qué deseas tratar y, si puedes, revisar fotos. El presupuesto definitivo se confirma en valoración médica."
              },
              {
                q: "¿Duele?",
                a: "Normalmente se utilizan medidas de confort y anestesia local según la zona. Eso lo confirma el doctor en la valoración, porque depende de cada caso."
              },
              {
                q: "¿Es cirugía?",
                a: "No es una cirugía tradicional ni una liposucción quirúrgica. Es un procedimiento láser mínimamente invasivo, pero igualmente requiere valoración médica previa."
              },
              {
                q: "No quiero rellenos",
                a: "Endolift® NO es un relleno. No aporta volumen ni cambia las facciones; está orientado a trabajar firmeza y definición natural."
              },
              {
                q: "Me da miedo",
                a: "Es totalmente normal. Por eso siempre trabajamos con una valoración médica previa, para ver si realmente eres candidata y explicarte todo con claridad."
              },
              {
                q: "Estoy lejos / No vivo en Madrid",
                a: "No pasa nada. Primero podemos orientarte por WhatsApp con fotos y, si tiene sentido para tu caso, coordinamos la valoración presencial después."
              }
            ].map((obj, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold text-primary">Objeción: "{obj.q}"</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm italic">"{obj.a}"</p>
                  <Button variant="ghost" size="sm" className="mt-2 h-7 gap-1 text-[10px]" onClick={() => copyToClipboard(obj.a)}>
                    <Copy className="w-3 h-3" /> Copiar Respuesta
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="info" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Resumen Técnico para Ventas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-3 bg-muted rounded-lg text-center">
                  <p className="text-xs text-muted uppercase font-bold">Tecnología</p>
                  <p className="text-sm font-semibold">Láser de Diodo</p>
                </div>
                <div className="p-3 bg-muted rounded-lg text-center">
                  <p className="text-xs text-muted uppercase font-bold">Tipo</p>
                  <p className="text-sm font-semibold">Mínimamente Invasivo</p>
                </div>
                <div className="p-3 bg-muted rounded-lg text-center">
                  <p className="text-xs text-muted uppercase font-bold">Anestesia</p>
                  <p className="text-sm font-semibold">Local (opcional)</p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="font-semibold text-sm">Zonas Clave:</p>
                <div className="flex flex-wrap gap-2">
                  {['Papada', 'Perfil Mandibular', 'Cuello', 'Abdomen', 'Flancos', 'Brazos', 'Espalda', 'Rodillas'].map(z => (
                    <span key={z} className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full border border-primary/20">{z}</span>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex gap-3">
                <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                <div className="text-xs text-yellow-700 dark:text-yellow-400">
                  <p className="font-bold mb-1">IMPORTANTE (Red Flags):</p>
                  <p>Si el lead menciona marcapasos, embarazo actual, o anticoagulantes, no confirmar tratamiento. Derivar directamente a valoración médica para que el doctor decida.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
